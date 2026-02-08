## Overview
Fully implement a spec file, verify its functionality, and commit.

## Inputs
Filename: $filename

## Steps:
1. Run command workflows\run_spec.md
    filename -> implemented source code

2. Run command workflows\verify_spec.md
    filename + implemented source code -> verification of correct functionality

3. If the spec is creating a tool
    - Run command .claude\commands\add_tools_to_project_overview.md
    implemented tool source code -> updated project overview documentation

4. Run command workflows\commit.md
    file changes -> git commit

5. Stop and ask user if the spec has been completed correctly

6. If the user says yes, move the spec file to specs/completed
    user confirmation -> spec file moved to specs/completed

## Output
Respond with a verification that the workflow completed successfully, with a brief summary of the changes.
