package ownership

import (
	"encoding/json"
	"strings"
	"testing"
)

func cohort() (Request, []byte, Report) {
	request := Request{Protocol: Protocol, AnalyzerSHA256: Digest([]byte("frontend")), CompilerVersion: "7.0.2", Sources: []Source{{Path: "tools/example/core.ts", SHA256: Digest([]byte("source"))}}}
	bytes, _ := json.Marshal(request)
	report := Report{Protocol: Protocol, RequestSHA256: Digest(bytes), AnalyzerSHA256: request.AnalyzerSHA256, CompilerVersion: request.CompilerVersion, Modules: []Module{{Path: request.Sources[0].Path, SHA256: request.Sources[0].SHA256}}}
	return request, bytes, report
}

func TestPolicyOwnsCapabilities(t *testing.T) {
	for _, capability := range []string{"process-launch", "runtime-loader", "process-object"} {
		t.Run(capability, func(t *testing.T) {
			request, bytes, report := cohort()
			report.Modules[0].Uses = []Use{{Capability: capability, Line: 1}}
			findings, err := Evaluate(request, bytes, report)
			if err != nil || len(findings) != 1 {
				t.Fatalf("findings=%v error=%v", findings, err)
			}
		})
	}
}

func TestIncompleteOrMixedReportsFail(t *testing.T) {
	cases := map[string]func(*Report){
		"missing":      func(report *Report) { report.Modules = nil },
		"duplicate":    func(report *Report) { report.Modules = append(report.Modules, report.Modules[0]) },
		"stale-source": func(report *Report) { report.Modules[0].SHA256 = Digest([]byte("other")) },
		"request":      func(report *Report) { report.RequestSHA256 = Digest([]byte("other")) },
		"frontend":     func(report *Report) { report.AnalyzerSHA256 = Digest([]byte("other")) },
		"compiler":     func(report *Report) { report.CompilerVersion = "other" },
		"protocol":     func(report *Report) { report.Protocol++ },
		"unknown-fact": func(report *Report) { report.Modules[0].Uses = []Use{{Capability: "unknown", Line: 1}} },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			request, bytes, report := cohort()
			change(&report)
			if findings, err := Evaluate(request, bytes, report); err == nil {
				t.Fatalf("incomplete report passed: %v", findings)
			}
		})
	}
}

func TestRolesAreNotApplicationNames(t *testing.T) {
	for _, name := range []string{"core", "shared", "reference", "protocol", "config"} {
		if !core("tools/arbitrary-tool/" + name + ".ts") {
			t.Fatal(name)
		}
	}
	for _, file := range []string{"tools/example/runner.ts", "tools/example/fixtures/core.ts", "tools/example/core.test.ts"} {
		if core(file) {
			t.Fatal(file)
		}
	}
}

func TestNativeLocationAndSourceArePreserved(t *testing.T) {
	request, bytes, report := cohort()
	report.Modules[0].Uses = []Use{{Capability: "process-object", Member: "env", Line: 17}}
	findings, err := Evaluate(request, bytes, report)
	if err != nil || len(findings) != 1 || findings[0].Line != 17 || !strings.HasSuffix(findings[0].Path, "core.ts") {
		t.Fatalf("%v %v", findings, err)
	}
}
