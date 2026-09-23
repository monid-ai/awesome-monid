# Contributing

Thanks for adding to the list. Read this once, it is short.

## How to submit

**Open a pull request that adds one entry to [`data/projects.yaml`](data/projects.yaml).**

1. Fork the repo.
2. Append your entry to `data/projects.yaml`, using the template below.
3. Run `npm run build`. That regenerates `README.md` from the data file. CI fails if you skip it.
4. Commit both files and open the pull request. One project per pull request.

```yaml
- id: your-project          # kebab-case, unique
  name: Your Project        # display name, no marketing suffix
  url: https://example.com  # what a reader should open first
  repo: owner/name          # "" if closed source
  author: "@yourhandle"
  category: markets-finance # an id from data/categories.yaml
  kind: [hosted, oss]       # hosted | oss | skill | writeup
  lang: [go]                # py | ts | go | rust | other
  cost: "$0.15/lead"        # your real Monid spend for one run, "" if you would rather not say
  monid: [run, runs]        # endpoints or capability areas used
  evidence: api-key         # how a reader can re-check the Monid call, see below
  description: One sentence that ends with a period.
  created: 2026-09-04       # repo creation date
  added: 2026-09-23         # the day you open the pull request
```

Leave `verified` out of your entry. A maintainer sets it after opening the link and confirming the
Monid call.

`evidence` is how anyone reading the list can re-check your claim. Pick the one that fits:
`api-url`, `api-key`, `cli-package`, `cli-command`, `rest-v1`, `readme-link`, `author-stated`.

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
