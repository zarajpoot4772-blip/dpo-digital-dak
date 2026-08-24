# Windows local database repair

PGlite's Node directory adapter can fail on Windows with:

```text
EINVAL: invalid argument, mkdir 'C:\...\data\pg'
```

The application no longer uses that adapter. PostgreSQL now runs in its portable in-memory filesystem and durable workflow data is atomically saved to:

```text
data\pglite-data.tar
```

The snapshot is loaded automatically on every restart. This design was tested by creating a new Branch Head, restarting the server, and successfully logging in with that new account.

## Apply the repaired version

Use the latest workspace. Stop the old server with `Ctrl+C`, then run:

```cmd
cd C:\path\to\latest-workspace\dpo-dak-system
rmdir /s /q .next
npm install
npm run dev
```

The obsolete `data\pg` directory is no longer read. If the previous database never initialized successfully, it can be removed:

```cmd
rmdir /s /q data\pg
```

Then open:

```text
http://localhost:3000/api/health
```

Expected response:

```json
{"status":"ok","database":"ready","users":5}
```

After that open `http://localhost:3000` and sign in.

## Backup

Back up these together while the server is stopped:

```text
data\pglite-data.tar
storage\originals\
storage\derived\
```

Do not copy an old failed `data\pg` directory over the repaired installation.
