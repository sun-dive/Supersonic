## Overview
Verify correct functionality of implemented spec

## Inputs
Filename: $filename
 - The spec file at the given filename has been executed.

## Context
The spec file at the given filename has been executed.

## Steps
1. read the spec file.
    filename -> spec file content

2. verify that it has been properly implemented.
    spec file content -> implemented source code -> implementation analysis

3. run the implemented code and verify that it works correctly.
    spec file content -> implemented source code -> test code -> test result

4. fix any errors.
    implemented source code + test results + implementation analysis -> corrected code

5. Repeat from step 3 until code is working.
    spec file content + corrected code -> Verification of correct functionality

## Output
Verification of correct functionality