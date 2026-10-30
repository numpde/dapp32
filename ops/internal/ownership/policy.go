// Package ownership owns common execution-role and capability policy.
package ownership

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

const Protocol = 1

type Source struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}

type Request struct {
	Protocol        int      `json:"protocol"`
	Root            string   `json:"root"`
	Config          string   `json:"config"`
	AnalyzerSHA256  string   `json:"analyzerSHA256"`
	CompilerVersion string   `json:"compilerVersion"`
	Sources         []Source `json:"sources"`
	PackageOutputs  []string `json:"packageOutputs"`
}

type Dependency struct {
	Specifier string `json:"specifier"`
	Target    string `json:"target"`
	Resolved  bool   `json:"resolved"`
	Line      int    `json:"line"`
}

type Use struct {
	Capability string `json:"capability"`
	Member     string `json:"member"`
	Line       int    `json:"line"`
}

type Module struct {
	Path         string       `json:"path"`
	SHA256       string       `json:"sha256"`
	Dependencies []Dependency `json:"dependencies"`
	Uses         []Use        `json:"uses"`
}

type Report struct {
	Protocol        int      `json:"protocol"`
	RequestSHA256   string   `json:"requestSHA256"`
	AnalyzerSHA256  string   `json:"analyzerSHA256"`
	CompilerVersion string   `json:"compilerVersion"`
	Modules         []Module `json:"modules"`
}

type Finding struct {
	Path string
	Line int
	Rule string
}

func Digest(bytes []byte) string {
	sum := sha256.Sum256(bytes)
	return hex.EncodeToString(sum[:])
}

var driverPath = regexp.MustCompile(`(^|/)(tests?|fixtures|([^/]+-)?(rehearsal|scenario))(/|$)|\.(test|spec)\.[cm]?[jt]sx?$`)

func core(file string) bool {
	if driverPath.MatchString(file) {
		return false
	}
	stem := strings.TrimSuffix(path.Base(file), path.Ext(file))
	switch stem {
	case "core", "shared", "reference", "protocol", "config":
		return true
	}
	return false
}

func adapter(file string) bool {
	stem := strings.TrimSuffix(path.Base(file), path.Ext(file))
	return stem == "main" || stem == "runner"
}

func admitModules(request Request, requestBytes []byte, report Report) (map[string]Module, error) {
	if request.Protocol != Protocol || report.Protocol != Protocol || report.RequestSHA256 != Digest(requestBytes) ||
		report.AnalyzerSHA256 != request.AnalyzerSHA256 || report.CompilerVersion != request.CompilerVersion {
		return nil, fmt.Errorf("cannot check execution ownership: analyzer report differs from the requested protocol, candidate or tool identity")
	}
	assigned := map[string]string{}
	for _, source := range request.Sources {
		if source.Path == "" || path.IsAbs(source.Path) || path.Clean(source.Path) != source.Path || strings.HasPrefix(source.Path, "../") || len(source.SHA256) != 64 {
			return nil, fmt.Errorf("cannot check execution ownership: malformed source identity %q", source.Path)
		}
		if _, exists := assigned[source.Path]; exists {
			return nil, fmt.Errorf("duplicate assigned source %s", source.Path)
		}
		assigned[source.Path] = source.SHA256
	}
	modules := map[string]Module{}
	for _, module := range report.Modules {
		if digest, exists := assigned[module.Path]; !exists || digest != module.SHA256 {
			return nil, fmt.Errorf("cannot check execution ownership: unexpected or changed module %s", module.Path)
		}
		if _, exists := modules[module.Path]; exists {
			return nil, fmt.Errorf("duplicate reported module %s", module.Path)
		}
		for _, use := range module.Uses {
			switch use.Capability {
			case "process-object", "process-launch", "runtime-loader":
			default:
				return nil, fmt.Errorf("unsupported capability %q in %s", use.Capability, module.Path)
			}
			if use.Line < 1 {
				return nil, fmt.Errorf("missing source location in %s", module.Path)
			}
		}
		for _, dependency := range module.Dependencies {
			if dependency.Specifier == "" || dependency.Line < 1 {
				return nil, fmt.Errorf("malformed dependency in %s", module.Path)
			}
		}
		modules[module.Path] = module
	}
	if len(modules) != len(assigned) {
		return nil, fmt.Errorf("cannot check execution ownership: analyzer coverage is incomplete")
	}
	return modules, nil
}

// Evaluate admits a complete report before interpreting any policy facts.
func Evaluate(request Request, requestBytes []byte, report Report) ([]Finding, error) {
	modules, err := admitModules(request, requestBytes, report)
	if err != nil {
		return nil, err
	}
	pending := []string{}
	for _, source := range request.Sources {
		if core(source.Path) {
			pending = append(pending, source.Path)
		}
	}
	if len(pending) == 0 {
		return nil, fmt.Errorf("cannot check execution ownership: no operation cores discovered")
	}
	seen := map[string]bool{}
	findings := []Finding{}
	for len(pending) > 0 {
		file := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if seen[file] {
			continue
		}
		seen[file] = true
		module, exists := modules[file]
		if !exists {
			return nil, fmt.Errorf("cannot analyze operation dependency %s", file)
		}
		for _, use := range module.Uses {
			rule := use.Capability
			if rule == "process-object" {
				if use.Member == "stderr" || use.Member == "exitCode" {
					continue
				}
				rule = "ambient-input"
			}
			findings = append(findings, Finding{file, use.Line, rule})
		}
		for _, dependency := range module.Dependencies {
			rule, traverse := dependencyPolicy(dependency, request.PackageOutputs)
			if rule != "" {
				findings = append(findings, Finding{file, dependency.Line, rule})
			}
			if traverse {
				if !dependency.Resolved {
					return nil, fmt.Errorf("cannot resolve operation dependency %s from %s", dependency.Specifier, file)
				}
				pending = append(pending, dependency.Target)
			}
		}
	}
	sort.Slice(findings, func(i, j int) bool {
		a, b := findings[i], findings[j]
		if a.Path != b.Path {
			return a.Path < b.Path
		}
		if a.Line != b.Line {
			return a.Line < b.Line
		}
		return a.Rule < b.Rule
	})
	return findings, nil
}

func dependencyPolicy(dependency Dependency, outputs []string) (string, bool) {
	specifier, target := dependency.Specifier, dependency.Target
	if driverPath.MatchString(specifier) || driverPath.MatchString(target) {
		return "driver-dependency", false
	}
	if strings.HasPrefix(specifier, "/") || strings.HasPrefix(specifier, "file:") || strings.HasPrefix(specifier, "#") {
		return "unsupported-import", false
	}
	if !strings.HasPrefix(specifier, ".") {
		return "", false
	}
	for _, output := range outputs {
		if strings.HasPrefix(target, output+"/") {
			return "", false
		}
	}
	if adapter(target) {
		return "adapter-dependency", false
	}
	if !strings.HasPrefix(target, "tools/") {
		return "unsupported-import", false
	}
	return "", true
}
