package analysis

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"cam/ops/internal/ownership"
)

func TestNativeCasesReachCommonPolicy(t *testing.T) {
	tooling := os.Getenv("CAM_ANALYZER_WORKSPACE")
	data, err := os.ReadFile(os.Getenv("CAM_EXECUTION_CASES"))
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name   string            `json:"name"`
		Files  map[string]string `json:"files"`
		Reject bool              `json:"reject"`
		Error  bool              `json:"error"`
	}
	if err = json.Unmarshal(data, &cases); err != nil {
		t.Fatal(err)
	}
	for _, example := range cases {
		t.Run(example.Name, func(t *testing.T) {
			root := sourceWorkspace(t, example.Files)
			request, err := Prepare(root, tooling)
			if err != nil {
				t.Fatal(err)
			}
			bytes, report, err := Collect(context.Background(), request, tooling)
			if example.Error {
				if err == nil {
					t.Fatal("invalid native syntax produced facts")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			findings, err := ownership.Evaluate(request, bytes, report)
			if err != nil {
				t.Fatal(err)
			}
			if (len(findings) > 0) != example.Reject {
				t.Fatalf("reject=%v findings=%v", example.Reject, findings)
			}
		})
	}
}

func TestFrontendEmitsNativeFactsNotPermissionDecisions(t *testing.T) {
	root := sourceWorkspace(t, map[string]string{"tools/core.ts": "export const settings = globalThis['process'].env"})
	request, err := Prepare(root, os.Getenv("CAM_ANALYZER_WORKSPACE"))
	if err != nil {
		t.Fatal(err)
	}
	_, report, err := Collect(context.Background(), request, os.Getenv("CAM_ANALYZER_WORKSPACE"))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Modules) != 1 || len(report.Modules[0].Uses) != 1 || report.Modules[0].Uses[0].Capability != "process-object" || report.Modules[0].Uses[0].Member != "env" {
		t.Fatalf("unexpected native facts: %+v", report)
	}
}

func TestChangedSourceCannotBePairedWithOldInventory(t *testing.T) {
	root := sourceWorkspace(t, map[string]string{"tools/core.ts": "export const value = 1"})
	file := filepath.Join(root, "tools", "core.ts")
	request, err := Prepare(root, os.Getenv("CAM_ANALYZER_WORKSPACE"))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file, []byte("export const value = process.env.VALUE"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := Collect(context.Background(), request, os.Getenv("CAM_ANALYZER_WORKSPACE")); err == nil {
		t.Fatal("changed source produced an admitted report")
	}
}

func sourceWorkspace(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"workspaces":[]}`), 0600); err != nil {
		t.Fatal(err)
	}
	for name, source := range files {
		file := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(source), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}
