# Build MendCue with Muse

Product: **MendCue**  
Tagline: **From customer symptoms to repair-ready handoffs.**  
Organization: `ker2i`  
Intended repository: `ker2i/mendcue`  
Local project directory: `/home/zemmli/appliance-intake`  
Full specification: [DESIGN.md](DESIGN.md)

This is a handoff prompt for the owner to give a Muse coding session. It does not mean that the application or GitHub repository has already been created, or that a running Muse session has been authorized by this document alone.

## Prompt to give Muse

> Build MendCue according to DESIGN.md in this project directory. It is a configurable, tenant-aware appliance intake platform for solo repair technicians, repair companies, and insurers, with an embedded website widget, a headless API, an optional hosted website, and a technician dashboard.
>
> Follow the hackathon scope and priorities in the specification. Start with a complete customer text intake through to a persisted technician handoff. Then add photo identification, reviewed knowledge retrieval, external embedding, and a second demonstration tenant. Report real verification results and keep incomplete features clearly identified.
>
> Commit the project to the GitHub organization ker2i using the repository name mendcue. Check GitHub authentication and repository permissions in your own execution environment first. Reuse an existing ker2i/mendcue repository if one already exists. If it does not exist, create it as private initially; apply any verified hackathon visibility requirements before submission.
>
> If this directory is not already its own Git repository, initialize a repository here. Do not accidentally commit a parent directory or unrelated files. Inspect any existing Git repository and remotes before changing them.
>
> Commit the design documentation and application in meaningful milestones. Run the appropriate checks before publishing implementation changes. Push to ker2i/mendcue using the owner's authenticated GitHub access. Do not force-push or overwrite unrelated remote work.
>
> Add the appropriate ignore rules before committing. Exclude actual secrets, environment files, customer data, uploaded media, private manuals, generated dependencies, build output, and local service state. Supply an environment template containing placeholders.
>
> If authentication or permissions are missing, identify the exact missing access and let the owner complete authentication through the tool's normal login mechanism. Never request credentials in project files or chat.

## Authentication notes

Muse Code can run Git and GitHub CLI commands in its execution environment. Its Meta login and its GitHub authentication are separate.

For a terminal session on the same machine, inspect `gh auth status`. Git can use GitHub CLI's authentication through `gh auth setup-git` when that is the intended HTTPS credential setup.

A Muse session in another VM, browser environment, or machine will not automatically inherit this machine's GitHub CLI login. Authenticate GitHub there or authorize its GitHub integration with write access to the selected organization repository. An integration that only reads repositories cannot push commits.

Organization membership alone does not supply credentials to an agent. The session needs both authenticated access and the necessary repository permissions. Branch protection and organization policies still apply.

References:

- [Muse Code](https://dev.meta.ai/docs/muse-code)
- [Adding locally hosted code to GitHub](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github)
- [Organization repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)
- [Organization programmatic access](https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization)
