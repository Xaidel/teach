package exercise

import "testing"

func TestWarmupCache(t *testing.T) {
	if Warmup() != "warm" {
		t.Fatal("expected the warmup placeholder to compile and pass")
	}
}
