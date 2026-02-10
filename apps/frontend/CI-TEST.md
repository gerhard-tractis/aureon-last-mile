# CI Pipeline Test

This file triggers the CI workflow by modifying apps/frontend directory.

## Purpose
The CI workflow (`.github/workflows/test.yml`) has a path filter that only triggers on changes to `apps/frontend/**`. This test file ensures the workflow runs on this PR.
