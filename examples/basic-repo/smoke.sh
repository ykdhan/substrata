#!/bin/bash

# Smoke test for basic-repo example.
# Tests the full workflow: init -> add -> index -> search -> context

set -e

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m' # No Color

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
TEMP_DIR=$(mktemp -d)

echo "Smoke test: Substrata basic-repo example"
echo "==========================================="
echo "Using CLI from: $REPO_ROOT/packages/cli/dist/bin.js"
echo "Temp dir: $TEMP_DIR"
echo ""

# Copy example to temp dir (excluding .substrata/index and dist)
cp -r "$SCRIPT_DIR/" "$TEMP_DIR/test-repo"
cd "$TEMP_DIR/test-repo"

# Remove generated index (so we test lazy rebuild)
rm -rf .substrata/index

CLI="node $REPO_ROOT/packages/cli/dist/bin.js"

# Test 1: Doctor (should work with existing config)
echo "Test 1: Run doctor to check setup..."
DOCTOR_OUTPUT=$($CLI doctor 2>&1)
if echo "$DOCTOR_OUTPUT" | grep -q "✔.*config valid"; then
  echo -e "${GREEN}✓${NC} Doctor passed config checks"
else
  echo -e "${RED}✗${NC} Doctor failed: $DOCTOR_OUTPUT"
  exit 1
fi

# Test 2: Index (should build from scratch)
echo ""
echo "Test 2: Build index..."
if $CLI index > /dev/null 2>&1; then
  if [ -f .substrata/index/footprint.sqlite ]; then
    echo -e "${GREEN}✓${NC} Index built: .substrata/index/footprint.sqlite"
  else
    echo -e "${RED}✗${NC} Index file not created"
    exit 1
  fi
else
  echo -e "${RED}✗${NC} Index build failed"
  exit 1
fi

# Test 3: Search for a keyword
echo ""
echo "Test 3: Search for 'pagination'..."
SEARCH_OUTPUT=$($CLI search "pagination" --json)
if [ -z "$SEARCH_OUTPUT" ]; then
  echo -e "${RED}✗${NC} Search returned empty"
  exit 1
fi

# Count results
RESULT_COUNT=$(echo "$SEARCH_OUTPUT" | grep -o '"id":' | wc -l)
if [ "$RESULT_COUNT" -gt 0 ]; then
  echo -e "${GREEN}✓${NC} Search found $RESULT_COUNT results"
else
  echo -e "${RED}✗${NC} Search found no results"
  exit 1
fi

# Test 4: Context (LLM-friendly output)
echo ""
echo "Test 4: Get context for a task..."
CONTEXT_OUTPUT=$($CLI context "I need to implement pagination" --json)
if [ -z "$CONTEXT_OUTPUT" ]; then
  echo -e "${RED}✗${NC} Context returned empty"
  exit 1
fi

# Verify context has sources
SOURCES_COUNT=$(echo "$CONTEXT_OUTPUT" | grep -o '"sources"' | wc -l)
if [ "$SOURCES_COUNT" -eq 1 ]; then
  echo -e "${GREEN}✓${NC} Context generated with sources"
else
  echo -e "${RED}✗${NC} Context missing sources"
  exit 1
fi

# Test 5: List recent
echo ""
echo "Test 5: List recent footprints..."
LIST_OUTPUT=$($CLI list 2>&1)
if echo "$LIST_OUTPUT" | grep -q "pagination"; then
  echo -e "${GREEN}✓${NC} Listed footprints successfully"
else
  echo -e "${RED}✗${NC} List returned invalid output"
  exit 1
fi

# Test 6: Show a specific footprint
echo ""
echo "Test 6: Show a specific footprint..."
SHOW_OUTPUT=$($CLI show "fp_20260609_implement_search_k7m2qx" 2>&1)
if echo "$SHOW_OUTPUT" | grep -q "full-text search"; then
  echo -e "${GREEN}✓${NC} Showed footprint fp_20260609_implement_search_k7m2qx"
else
  echo -e "${RED}✗${NC} Show returned invalid output"
  exit 1
fi

# Test 7: Add a new footprint
echo ""
echo "Test 7: Add a new footprint..."
ADD_OUTPUT=$($CLI add \
  --title "Example footprint from smoke test" \
  --purpose "Testing the full workflow" \
  --actor "smoke-test" \
  --requester "test@example.com" \
  --notes "This footprint was created by the smoke test script" \
  --tag smoke-test \
  --files "smoke.sh" 2>&1)

if echo "$ADD_OUTPUT" | grep -q "Footprint written"; then
  NEW_ID=$(echo "$ADD_OUTPUT" | grep "fp_" | head -1 | grep -o "fp_[a-z0-9_]*")
  echo -e "${GREEN}✓${NC} Added footprint: $NEW_ID"
else
  echo -e "${RED}✗${NC} Add failed: $ADD_OUTPUT"
  exit 1
fi

# Test 8: Search should find the new footprint
echo ""
echo "Test 8: Search should find newly added footprint..."
NEW_SEARCH=$($CLI search "smoke test" --json)
if echo "$NEW_SEARCH" | grep -q "smoke-test"; then
  echo -e "${GREEN}✓${NC} New footprint found in search results"
else
  echo -e "${RED}✗${NC} New footprint not found in search"
  exit 1
fi

# Cleanup
cd /
rm -rf "$TEMP_DIR"

echo ""
echo "==========================================="
echo -e "${GREEN}All smoke tests passed!${NC}"
echo ""
