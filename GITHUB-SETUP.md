# GitHub workflow for DPO Digital Dak

This project is now Git-ready. The repository should be **private** because the source contains department workflow rules and demo account seed logic.

## What is excluded automatically

The `.gitignore` excludes:

- `node_modules` and `.next`
- `.env` files and secret/key files
- local PGlite snapshot data
- original, derived and signature files under `storage/`
- build, cache, log and editor files

Do not put real departmental documents, passwords, database exports or signature/stamp images in GitHub.

## First upload with GitHub Desktop

1. Create a new **Private** repository on GitHub, for example `dpo-digital-dak`.
2. In GitHub Desktop choose **Add existing repository**.
3. Select this `dpo-dak-system` folder.
4. Review the files. Only source/configuration/documentation files should appear; local data and private files must not appear.
5. Commit the initial version with a message such as `Initial DPO Digital Dak version`.
6. Click **Publish repository** and keep it private.

## Command-line alternative

After creating the empty private repository, run these commands in this folder. Replace the URL with your own repository URL; do not put a password or token in the URL.

```bash
git remote add origin https://github.com/YOUR-ACCOUNT/dpo-digital-dak.git
git branch -M main
git push -u origin main
```

GitHub will ask for authentication through its normal browser/credential flow. Never paste a GitHub personal access token into chat.

## Future change workflow

```bash
npm install
npm run typecheck
npm run build
npm run test:smoke

git add .
git commit -m "Describe the change"
git push
```

For online deployment, connect the private GitHub repository to the hosting provider. A push to the selected production branch can then trigger a deployment. The current local PGlite/filesystem prototype still needs PostgreSQL and private cloud storage migration before it is used as a permanent public online system.
