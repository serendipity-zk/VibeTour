# VibeTour Workspace

This workspace provides two layouts for trying VibeTour:

- `Request Lifecycle` is discovered from the workspace-level `.code-lessons` directory.
- `Nested Repo Checkout` is discovered from `repos/checkout-service/.code-lessons`, as if `checkout-service` were one repository inside a multi-repo workspace.

The nested lesson deliberately refers to files such as `src/checkout.py`. VibeTour resolves those paths from `repos/checkout-service`, the parent of that lesson's `.code-lessons` directory, rather than from this outer workspace.

Use the **VibeTour** book icon in the Activity Bar, start a chapter, and try the inline code and related-location links.
