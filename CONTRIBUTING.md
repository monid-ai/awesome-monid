# Contributing

Thanks for adding to the list. Read this once, it is short.

## How to submit

**Open a pull request that adds one entry to [`data/projects.yaml`](data/projects.yaml).**

1. Fork the repo.
2. Append your entry to `data/projects.yaml`, using the template below.
3. Run `npm run build`. That regenerates `README.md` from the data file. CI fails if you skip it.
4. Commit both files and open the pull request. One project per pull request.

```yaml
- id: your-project
  name: Your Project
  url: https://example.com
  repo: owner/name
  author: "@yourhandle"
  category: markets-finance
  kind: [hosted, oss]
  lang: [go]
  cost: "$0.15/lead"
  monid: [run, runs]
  evidence: api-url
  description: One sentence that ends with a period.
  created: 2026-09-04
  added: 2026-09-23
```

Copy that block as it stands. The reader in `scripts/build.mjs` is a small hand-rolled one: it
skips a line that starts with `#`, but it does not strip a comment that trails a value, so a
`# note` after any field breaks the build.

What each field takes:

- `id` kebab-case, unique, never reused
- `name` display name, no marketing suffix
- `url` what a reader should open first, the live app or the repo
- `repo` `owner/name` on GitHub, or `""` if closed source
- `author` how you want to be credited
- `category` an id from [`data/categories.yaml`](data/categories.yaml)
- `kind` one or more of `hosted`, `oss`, `skill`, `writeup`
- `lang` one or more of `py`, `ts`, `go`, `rust`, `other`, or `[]` if none applies
- `cost` your real Monid spend for one run, `""` if you would rather not say
- `monid` the endpoints or capability areas the project calls
- `evidence` how a reader can re-check that call, one of `api-url`, `api-key`, `cli-package`,
  `cli-command`, `rest-v1`, `readme-link`, `author-stated`
- `description` one sentence, ends with a period, 160 characters max
- `created` the repo creation date
- `added` the day you open the pull request

Leave `verified` out of your entry. A maintainer sets it after opening the link and confirming the
Monid call.

Do not hand-edit `README.md`. Everything between the `BEGIN GENERATED` and `END GENERATED` markers
is produced by `scripts/build.mjs`, and an edit there would be erased on the next build.

You may submit a project you did not build. Credit the actual author in the `author` field.

## What gets in

An entry has to clear all of these:

1. **It was built outside the Monid team.** Work from `monid-ai`, and from anyone on the team, is
   rejected automatically, apart from a short allowlist the maintainers keep. This list is worth
   reading because nearly everything on it is other people's, so that allowlist stays short.
2. **It calls Monid.** Either visible in public source (`api.monid.ai`, `MONID_API_KEY`,
   `@monid-ai/cli`, a `monid run` command, the MCP server), or the author confirms it. Every entry
   stores which of those it was in its `evidence` field, so any reader can re-check the claim.
3. **It is a thing someone can use.** A shipped service, an installable skill or plugin, a
   fork-and-run template, or a write-up that teaches something specific. A demo that wraps one
   endpoint and adds nothing is not enough.
4. **One project per submission.**

There is no star floor and no minimum age. Most of what gets built here is days old and has zero
stars, and a rule that filtered those out would leave an empty page. Curation happens in review
instead. Hackathon entries are in regardless, since the event already did the vetting.

Closed-source hosted products are welcome. A maintainer will check with you privately that Monid is
actually in the stack before it is listed.

## Writing the entry

- **Description**: one sentence, starts with a capital, ends with a period, 160 characters max. No
  emoji, no em dashes, no marketing. Say what it does for the reader, not how excited you are.
  - Good: `Turns a company domain into a funding-signal brief with sources attached.`
  - Bad: `The ultimate AI-powered research platform. Blazing fast!`
- **Cost**: optional but strongly encouraged. Your real Monid spend for one complete run, for
  example `$0.15/lead` or `$0.33/video`. Take it from your bill, not from a guess. This is the
  single most useful column on the list and readers do check it.
- **Category**: pick one from `data/categories.yaml`. If nothing fits, say so in the pull request
  rather than forcing it, and we will discuss adding a category.
- **Kind and language**: these print as backtick tags on your entry, like `hosted` `Python`. Pick `oss` for open source even though it prints nothing, the Source Code link carries that.

## Removal

A listed project that goes offline, gets abandoned, or stops using Monid will be removed. Link
checks run weekly. If something of yours should come down, open an issue and it comes down, no
questions asked.

## Local development

```sh
node scripts/build.mjs          # regenerate README.md from data/
node scripts/build.mjs --check  # what CI runs: fails if README is stale
```

No dependencies, no install step. Node 18 or newer.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). By contributing you agree your contribution is
released under [CC0](LICENSE).
