// Package analysis joins native source facts to the common ownership policy.
package analysis

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"cam/ops/internal/ownership"
	"cam/ops/internal/process"
)

func Prepare(root, tooling string) (ownership.Request, error) {
	request := ownership.Request{Protocol: ownership.Protocol, Root: root, Config: filepath.Join(tooling, "tsconfig.tool.json")}
	frontend, err := os.ReadFile(filepath.Join(tooling, "tools/execution-facts.mjs"))
	if err != nil {
		return request, err
	}
	request.AnalyzerSHA256 = ownership.Digest(frontend)
	var compiler struct {
		DevDependencies map[string]string `json:"devDependencies"`
	}
	data, err := os.ReadFile(filepath.Join(tooling, "package.json"))
	if err != nil {
		return request, err
	}
	if err = json.Unmarshal(data, &compiler); err != nil {
		return request, err
	}
	request.CompilerVersion = compiler.DevDependencies["typescript"]
	if request.CompilerVersion == "" {
		return request, fmt.Errorf("missing pinned TypeScript version")
	}
	var workspace struct {
		Workspaces []string `json:"workspaces"`
	}
	data, err = os.ReadFile(filepath.Join(root, "package.json"))
	if err != nil {
		return request, err
	}
	if err = json.Unmarshal(data, &workspace); err != nil {
		return request, err
	}
	for _, directory := range workspace.Workspaces {
		if strings.HasPrefix(directory, "packages/") {
			request.PackageOutputs = append(request.PackageOutputs, directory+"/dist")
		}
	}
	err = filepath.WalkDir(filepath.Join(root, "tools"), func(file string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("analysis source must not be a symlink: %s", file)
		}
		if entry.IsDir() {
			return nil
		}
		switch filepath.Ext(file) {
		case ".ts", ".mts", ".cts", ".js", ".mjs", ".cjs":
		default:
			return nil
		}
		data, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		name, err := filepath.Rel(root, file)
		if err != nil {
			return err
		}
		request.Sources = append(request.Sources, ownership.Source{Path: filepath.ToSlash(name), SHA256: ownership.Digest(data)})
		return nil
	})
	sort.Slice(request.Sources, func(i, j int) bool { return request.Sources[i].Path < request.Sources[j].Path })
	return request, err
}

func Collect(ctx context.Context, request ownership.Request, tooling string) ([]byte, ownership.Report, error) {
	var report ownership.Report
	input, err := json.Marshal(request)
	if err != nil {
		return nil, report, err
	}
	output, err := process.Output(ctx, tooling, "node", []string{filepath.Join(tooling, "tools/execution-facts.mjs")}, input)
	if err != nil {
		return input, report, err
	}
	decoder := json.NewDecoder(bytes.NewReader(output))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&report); err != nil {
		return input, report, fmt.Errorf("invalid analyzer report: %w", err)
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return input, report, fmt.Errorf("analyzer emitted trailing report bytes")
	}
	return input, report, nil
}

func Check(ctx context.Context, root, tooling string) ([]ownership.Finding, error) {
	request, err := Prepare(root, tooling)
	if err != nil {
		return nil, err
	}
	input, report, err := Collect(ctx, request, tooling)
	if err != nil {
		return nil, err
	}
	return ownership.Evaluate(request, input, report)
}
