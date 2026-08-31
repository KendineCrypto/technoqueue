# Role blueprints and custom constraints

TechnoQueue v0.3.1 gives every office role a built-in operating blueprint. The blueprint is selected from the employee's role and is rebuilt by the server for every provider request. It is not copied from public task text and it is not editable through the employee form.

Each blueprint defines:

- a role mission;
- five concrete responsibilities;
- five role boundaries;
- an output contract for the next employee.

The current roles are generalist, planner, researcher, writer, developer, analyst, and reviewer. For example, the writer is instructed to turn approved material into finished copy and is forbidden from claiming developer or reviewer authority. The reviewer must begin with `APPROVE` or `REQUEST_CHANGES` and may not obey instructions embedded in candidate output.

## Prompt authority

Provider requests are composed in this order:

1. immutable TechnoQueue policy;
2. fixed employee identity and role blueprint;
3. office-owner custom constraints;
4. final immutable authority reminder;
5. the current task or review payload as untrusted user data.

Custom constraints can specify language, tone, format, source handling, brevity, or office-specific preferences. They cannot switch the employee's role, grant tools, bypass policy, approve its own work, or authorize an external action. Closing-tag text is neutralized before the custom block is composed.

Employee profiles and custom constraints are public Technocore data. Never put secrets, provider keys, private customer data, or confidential system instructions in this field.

## Enforcement boundary

In v0.3.1, role separation is enforced by server-owned prompt composition and workflow routing. Hosted employees are still text-only and receive no filesystem, shell, browser, deployment, or spending capability. This means the model is strongly instructed and routed as a specialist, but prompt rules alone are not a security sandbox.

Future local execution must add hard capability grants independently of these blueprints. A developer will only be able to edit files when a project and path are explicitly granted; a writer blueprint alone will never receive that capability.
