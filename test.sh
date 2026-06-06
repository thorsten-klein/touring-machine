#!/bin/bash -e
# Run the playwright tests with coverage

# Clean previous coverage data
rm -rf .nyc_output

# Run tests
npx playwright test --reporter=list "$@" 2>&1

# Clean previous coverage report
rm -rf coverage

# Generate coverage report if tests ran
if [ -d .nyc_output ] && [ "$(ls -A .nyc_output 2>/dev/null)" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Coverage Report"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    npx nyc report --reporter=text --reporter=html --report-dir=coverage
    echo ""
    echo "HTML coverage report: coverage/index.html"

    # Fail if any metric is below 100%. In CI, the test job's .nyc_output is
    # still uploaded as an artifact (if: always()) and the coverage job still
    # runs (if: !cancelled()), so Codecov receives the data either way.
    SUMMARY=$(npx nyc report --reporter=text-summary 2>/dev/null)
    check_metric() {
        local label="$1"
        local pct
        # Format: "Statements   : 100% ( 1965/1965 )"
        pct=$(echo "$SUMMARY" | grep "$label" | grep -o ': *[0-9]*\(\.[0-9]*\)\?%' | grep -o '[0-9]*\(\.[0-9]*\)\?' | head -1)
        if [ -z "$pct" ]; then
            echo "ERROR: Could not parse $label coverage" >&2
            exit 1
        fi
        if [ "$(echo "$pct < 100" | bc -l)" -eq 1 ]; then
            echo ""
            echo "FAIL: $label coverage is ${pct}% (required: 100%)" >&2
            exit 1
        fi
    }
    check_metric "Statements"
    check_metric "Branches"
    check_metric "Functions"
    check_metric "Lines"
    echo ""
    echo "All coverage metrics at 100%."
fi
