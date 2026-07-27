# Releasing VibeTour

VibeTour releases are driven by immutable version tags. A pushed `v*` tag runs
`.github/workflows/release.yml`, which:

1. installs locked dependencies;
2. runs checks and tests;
3. verifies that the tag matches `package.json`;
4. builds and uploads one versioned VSIX;
5. attaches that exact VSIX to a GitHub Release;
6. publishes the same verified VSIX to the VS Code Marketplace.

## One-time GitHub setup

Create a GitHub Actions environment named `marketplace`. Add deployment
protection rules if desired; only the Marketplace publishing job uses this
environment and its credentials.

Configure one of the following authentication methods as environment secrets.
When both are present, the workflow prefers Microsoft Entra ID.

### Microsoft Entra ID with OIDC (recommended)

Create a user-assigned managed identity in the Azure portal:

- Resource group: `vibetour-release`
- Identity name: `vibetour-github-release`
- Region: any region available to the selected subscription

Give the identity the **Reader** role on the resource group. Under the
identity's **Federated credentials**, choose **Other issuer** and add:

- Name: `github-marketplace`
- Issuer: `https://token.actions.githubusercontent.com`
- Subject:
  `repo:serendipity-zk@54904336/VibeTour@1305369739:environment:marketplace`
- Audience: `api://AzureADTokenExchange`

The immutable owner and repository IDs are required because this repository was
created after GitHub enabled immutable OIDC subjects for new repositories.

Create the GitHub `marketplace` environment, then add:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

Run **Build and release VibeTour** manually with **Resolve the Entra identity
profile ID without publishing** enabled. The workflow summary prints the
Marketplace identity profile ID. In the Marketplace publisher portal, add that
identity to publisher `vibetour` with the **Contributor** role.

The tag workflow then requests an OIDC token and publishes with
`vsce publish --azure-credential`; no long-lived Marketplace token is stored.

### VSCE personal access token (temporary fallback)

Add `VSCE_PAT` to the `marketplace` environment. The token needs **Marketplace
(Manage)** scope and access to all organizations available to the publisher.
Never add the token to the repository, workflow YAML, command line, or logs.

Microsoft has announced retirement of global Azure DevOps PATs on December 1,
2026, so migrate this fallback to Entra ID before then.

## Publish a version

Update `package.json` and the two top-level VibeTour version fields in
`package-lock.json`, validate the release, commit it, and push `main` together
with the matching annotated tag:

```bash
git push --atomic origin main v0.0.6
```

The Marketplace job runs only for tags. A manual `workflow_dispatch` validates
and packages the current revision without publishing it.

Do not reuse or move a published version tag. If a release fails after its tag
is public, fix the issue and publish a new patch version.
