package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"cam/ops/internal/analysis"
)

func run() error {
	if len(os.Args) != 3 || os.Args[1] != "check" {
		return fmt.Errorf("usage: cam-ops check <staged-js-workspace>")
	}
	root, err := filepath.Abs(os.Args[2])
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	findings, err := analysis.Check(ctx, root, root)
	if err != nil {
		return err
	}
	for _, finding := range findings {
		fmt.Printf("%s:%d: %s\n", finding.Path, finding.Line, finding.Rule)
	}
	if len(findings) > 0 {
		return fmt.Errorf("execution ownership failed: %d finding(s)", len(findings))
	}
	fmt.Println("Execution ownership: checked source cohort passed")
	return nil
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
