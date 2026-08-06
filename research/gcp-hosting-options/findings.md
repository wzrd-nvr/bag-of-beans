# GCP hosting and event-landing under scale-to-zero

Research for [#8](https://github.com/wzrd-nvr/bag-of-beans/issues/8), part of the v1 map
([#1](https://github.com/wzrd-nvr/bag-of-beans/issues/1)).

**Every price below was read from a first-party Google page on 2026-08-03.** Pricing moves;
re-verify before committing spend. Claims I could not confirm are marked **UNCONFIRMED** rather
than filled in from memory. Arithmetic I performed on Google's published rates is labelled as mine,
not as something Google wrote.

Region **us-central1** throughout — it is a Tier 1 Cloud Run region and it is one of the three
regions where the Cloud Storage always-free tier applies, so staying there keeps every free tier on
the table.

> **Docs moved.** `cloud.google.com/*/docs/*` now 301-redirects to `docs.cloud.google.com`.
> `/pricing` pages stayed on `cloud.google.com`. Both are first-party. Several pricing pages are
> large enough that naive fetching truncates them — the figures here were extracted from raw HTML.

---

## Recommendation

**Firebase Hosting (site) + Cloud Run at `min-instances=0` (service) + structured JSON on stdout
into Cloud Logging, with the `_Default` bucket upgraded to Log Analytics (events).**

One domain, via Firebase Hosting rewrites to the Cloud Run service for `/mcp` and `/api/*`.

**Cost: ~$0.01/month at 1,000 requests. $0.99–$6.24/month at 50,000**, where the variable part is
almost entirely *site* bandwidth (page weight decides it), not the service and not the telemetry —
both of which stay at $0.00 across the whole range. Full arithmetic in §4.

Why this combination:

- **It is the only set with a genuine $0 floor.** The alternatives are not marginally more
  expensive, they are structurally more expensive: Cloud Storage + Cloud CDN needs a load balancer
  at **$18.25/month before a single request arrives** (§1), and `min-instances=1` on Cloud Run
  costs **~$9.86/month gross** (§2). Both are permanent charges for an idle personal project.
- **The telemetry sink falls out of a Cloud Run constraint, not a price comparison.** Firestore,
  BigQuery and Cloud Logging are all $0 at these volumes, so cost does not decide it. What decides
  it is that Cloud Run's request-based billing forbids work after the response (§3, Appendix C), so
  the event write sits on the critical path of every request. `console.log` of a JSON line is the
  only sink with no network round trip inside the billed window.
- **It is instructive.** Buildpacks, a Cloud Build trigger, log-based structured telemetry, and
  Log Analytics SQL over it are all real GCP practice. None of it is an idle cluster.
- **Setup burden is near zero**, which the constraints say to weigh: Firebase CLI installs with the
  npm the developer already has, and everything requiring `gcloud` can be done in Cloud Shell (§5).

The one thing to watch is **Artifact Registry**, the only line item that grows while you do nothing
(§4.4).

---

## 1. Site hosting

| | Idle cost/month | CDN | Custom domain + TLS | Verdict |
|---|---|---|---|---|
| **Firebase Hosting** | **$0.00** | Global CDN, included, free | Free, auto-provisioned, auto-renewed | **Recommended** |
| Cloud Storage + Cloud CDN | **$18.25** | Yes, $0.08/GiB NA egress | Cert free, but the LB is *mandatory* for HTTPS | Rejected |
| Cloud Run serving a built app | $0 scaled to zero, but $18.25 once you add the LB you need for a CDN | None without an LB | Domain mappings are **Preview, "not production-ready"** | Rejected for the site |

### Firebase Hosting

Spark (no-cost) plan: **10 GB storage**, custom domain and SSL included, multiple sites per project.
Blaze keeps the same free allotment and charges **$0.026/GB** storage and **$0.15/GB** transfer
beyond it. There is no fixed or per-site monthly charge anywhere on either page — a parked site
under 10 GB is **$0.00/month**.
Sources: <https://firebase.google.com/pricing>,
<https://firebase.google.com/docs/hosting/usage-quotas-pricing> (checked 2026-08-03).

TLS is automatic: *"Firebase Hosting provisions an SSL certificate for each of your domains and
serves your content over a global CDN."*
(<https://firebase.google.com/docs/hosting/custom-domain>). The CDN is free and on by default —
*"Every Hosting site is automatically backed by our global CDN at no charge"* — and redeploying
auto-purges it. Cache headers are overridable via `firebase.json` `headers` with glob or RE2
matching (<https://firebase.google.com/docs/hosting/manage-cache>,
<https://firebase.google.com/docs/hosting/full-config>).

> ⚠️ **Two official pages disagree on the free transfer allowance.** The pricing page says
> **360 MB/day**; the quotas doc says **10 GB/month**. Those are roughly equivalent in total
> (360 MB/day ≈ 10.8 GB/month) but the *enforcement window* differs, and that matters for a
> traffic spike or a post that gets shared. **UNCONFIRMED which governs.** §4 costs both readings.

Two further caveats worth carrying forward:

- *"Both cache hits and misses count toward your project's Hosting data transfer usage."* You
  cannot reduce the billed transfer with a better cache-hit ratio, unlike Cloud CDN.
- Dynamic content served via a rewrite is sent with **`Cache-Control: private`** and is not
  CDN-cached. Expected, but it means the `/api/*` responses get no CDN benefit.

**No deprecation.** Hosting is not marked deprecated and there is no migration notice. The only
banner is a promotion for **Firebase App Hosting**, which is a *different product* — Cloud Run-backed,
Blaze-only, and it drags in Cloud Build, Artifact Registry and Cloud Logging pass-through charges
for a site that needs none of them. Do not confuse the two.

### Why Cloud Storage + Cloud CDN loses

The killer is the load balancer, and it is unavoidable: *"Because Cloud Storage doesn't support
custom domains with HTTPS on its own, this tutorial uses Cloud Storage with an external Application
Load Balancer... You can also use Cloud Storage to serve custom domain content over HTTP, which
doesn't require a load balancer."*
(<https://docs.cloud.google.com/storage/docs/hosting-static-website>). The legacy CNAME mode still
exists but is **HTTP-only** — not an option for a public site in 2026.

External Application Load Balancer forwarding rules cost **$0.025/hour** covering the first five
rules, plus $0.008/GiB data processed (<https://cloud.google.com/vpc/network-pricing>). At 730
hours that is **$18.25/month, idle** — my arithmetic on Google's hourly rate.

One clarification, because a careless read of that page inflates the figure fourfold: the "minimum
proxy instance charge" (3 × $0.025/hr) is explicitly scoped to forwarding rules with scheme
`INTERNAL_MANAGED`. An external ALB is **not** subject to it. $18.25 is the correct floor, not $73.

Storage itself is cheap and mostly free — 5 GB-months free (us-central1/us-east1/us-west1 only;
a US multi-region bucket gets **no** free tier), then $0.020/GiB-month regional
(<https://cloud.google.com/storage/pricing>). Cloud CDN is $0.08/GiB NA egress, $0.01/GiB cache
fill, $0.0075 per 10,000 lookups (<https://cloud.google.com/cdn/pricing>). Managed certs are free
to 100 (<https://cloud.google.com/certificate-manager/pricing>). None of that rescues the $18.25.

**Break-even (my arithmetic):** Firebase at $0.15/GB over 10 GB versus $18.25 + $0.08/GB.
`0.15(X − 10) = 18.25 + 0.08X` → **X ≈ 282 GB/month** (both ≈ $40.82). GCS + Cloud CDN only starts
winning above ~282 GB of monthly transfer — roughly 25× this project's plausible peak.

### Why Cloud Run loses for the *site*

Google's own custom-domain page ranks the LB first and warns, verbatim, about the alternative:

> Cloud Run domain mappings are in the preview launch stage. **Due to latency issues, they are not
> production-ready and are not supported at General Availability. At the moment, this option is not
> recommended for production services.**

Plus: no wildcard certs, no self-managed certs, cannot disable TLS 1.0/1.1, root path only, 10
supported regions (<https://docs.cloud.google.com/run/docs/mapping-custom-domains>). And Cloud Run
has **no CDN** of its own — a CDN only appears via the load balancer, back to $18.25.

**This is why the Firebase Hosting rewrite matters so much:** it is the *only* $0 path to a custom
domain in front of Cloud Run. Confirmed live and undeprecated
(<https://firebase.google.com/docs/hosting/cloud-run>):

```json
"rewrites": [{ "source": "/mcp", "run": { "serviceId": "bob", "region": "us-central1" } }]
```

> **UNCONFIRMED:** whether Firebase Hosting imposes its own request/response timeout or body-size
> limit on rewrites to Cloud Run. I did not find a documented figure. Not a v1 risk — MCP responses
> here are small JSON and SSE is out of scope — but confirm before streaming anything through it.
> The `*.run.app` URL always works as a direct bypass.

---

## 2. Service hosting — Cloud Run under scale-to-zero

Google has a page dedicated to exactly this workload:
<https://docs.cloud.google.com/run/docs/host-mcp-servers> (checked 2026-08-03).

> Cloud Run supports hosting MCP servers with streamable HTTP transport, but not MCP servers with
> stdio transport.

That page gives auth guidance and deploy commands but — checked directly — offers **no** guidance
on stateless vs stateful, session management, concurrency, timeouts, or min-instances. The
configuration below is derived from the general Cloud Run docs and the MCP spec.

### Rates (us-central1, request-based billing, list)

| Resource | Active | Idle (min-instances only) |
|---|---|---|
| CPU, per vCPU-second | **$0.000024** | $0.0000025 |
| Memory, per GiB-second | **$0.0000025** | $0.0000025 |
| Requests, per 1,000,000 | **$0.40** | — |

Free tier: **180,000 vCPU-seconds, 360,000 GiB-seconds, 2,000,000 requests per month**, aggregated
**across projects by billing account**, reset monthly. Billing is *"rounded up to the nearest 100
millisecond"* on aggregate instance time, not per request — concurrent requests do not each incur a
separate floor. Source: <https://cloud.google.com/run/pricing> (checked 2026-08-03).

Request-based billing is the **default**; instance-based ("CPU always allocated") is opt-in and
should stay off (<https://docs.cloud.google.com/run/docs/configuring/billing-settings>).

### `min-instances=0` and the MCP client's first request

**Idle cost is exactly zero.** The pricing page states *"Idle instances that are not minimum
instances are not charged"*, and the min-instances doc states *"If min instances is set to `0`, you
are not billed when instances are idle."* Better, Google absorbs some warm-keeping itself:
*"To minimize cold starts, Cloud Run might keep instances idle for a period of time after they
finish handling requests (up to 15 minutes...)"*
(<https://docs.cloud.google.com/run/docs/about-instance-autoscaling>).

**Google does not publish a cold-start latency figure.** I checked the general tips, container
contract, autoscaling, and Node.js tips pages — none states a millisecond or second value. I am not
inventing one. What *is* documented bounds the behaviour:

- **Startup timeout: 4 minutes**, not increasable (<https://docs.cloud.google.com/run/quotas>).
- The first request is queued, not dropped: *"Requests will pend for up to 3.5 times average
  startup time of container instances of this service, or 10 seconds, whichever is greater."*
- **Cold-start time is billed** — instances are charged *"when they start, and when they shut
  down"*.

So an MCP client's very first request after idle **waits, it does not fail**. For a bundled Node
container this is a sub-second-to-low-seconds wait, but that range is my expectation, not a Google
figure — **treat the actual number as UNCONFIRMED until measured.** Measuring it is a cheap first
task once deployed.

The only Google-sourced quantitative claim is marketing-grade: the startup CPU boost announcement
blog says Node.js private-preview users *"observed startup time reductions of up to 30%"*. A blog,
a preview, and a percentage — not an SLO.

**Startup CPU boost is enabled by default on new services** and doubles CPU during startup plus 10
seconds after. It *is* charged for that window
(<https://docs.cloud.google.com/run/docs/configuring/services/cpu>). At this volume the extra is
pennies inside the free tier. Leave it on.
*(Note: the URL `/run/docs/configuring/services/startup-cpu-boost` 404s; content moved to `/cpu`.)*

**Node startup advice Google actually gives** (<https://docs.cloud.google.com/run/docs/tips/nodejs>):

1. *"Start your application directly using `node index.js` instead of `npm start`, as npm adds
   extra latency."*
2. Bundle with esbuild/webpack/rollup — *"Bundlers significantly reduce the total size of the
   bundle and reduce the number of file read requests."*
3. Lazy-load: *"At startup, Cloud Run streams each file that your code loads from a remote
   location... this leads to additional latency each time a file is read."*

For a bundled single-file MCP server these three together remove most of the controllable startup
cost.

### Timeout

**Default 300 s (5 min), maximum 3600 s (60 min)**
(<https://docs.cloud.google.com/run/docs/configuring/request-timeout>). Since the server answers
POSTs with `application/json` and no SSE (Appendix A), requests last milliseconds — **the timeout
is a non-issue.** Lowering it to 60 s is free defence against a hung handler.

Google's warning for long timeouts is nonetheless the most important architectural line in the
docs: *"When a client re-connects, a new request is initiated and the client isn't guaranteed to
connect to the same instance of the service."* This is the same fact that forces statelessness.

### Concurrency

Default **80** (or 80 × vCPU when deployed via gcloud/Terraform); maximum **1000**; minimum 1
(<https://docs.cloud.google.com/run/docs/configuring/concurrency>). The billing mechanism, in
Google's words: *"A higher concurrency setting lets fewer instances handle the same request volume,
which can reduce costs."* You pay for instance-time, not request-time, so per-request cost falls
roughly linearly with achieved concurrency. Google's own pricing examples show a **$13.69 vs
$81.72/month** swing on identical traffic from concurrency 20 vs 1 — a 6× difference.

At 50,000 requests/month (~1.15/minute) genuine concurrency will essentially never occur, so this
does not move the bill. **Leave the default.** Setting `--concurrency 1` would be actively harmful.
Google's Node caveat applies: *"Node.js is inherently single-threaded. To take advantage of
concurrency, use JavaScript's asynchronous code style"* — fine for an async MCP handler.

### Settings summary

| Setting | Value | Why |
|---|---|---|
| `--min-instances` | **0** | Exactly $0 idle. The floor of the whole posture. |
| `--max-instances` | 2–5 | Cost blast radius. There is no hard spend cap (§5). |
| `--concurrency` | default (80) | Cheapest per request; no reason to lower. |
| `--timeout` | 60s | Default 300s is fine; 60s is tighter with no downside given no SSE. |
| `--cpu` / `--memory` | 1 vCPU / 512 MiB | Basis for §4. |
| CPU boost | on (default) | Cuts startup; negligible cost inside free tier. |
| Session affinity | **off** | Best-effort only, and useless under scale-to-zero (Appendix B). |

### Cloud Run functions is not a cheaper alternative

"Cloud Functions" is now **Cloud Run functions**, and it *is* a Cloud Run service — *"For Cloud Run
functions, see Cloud Run pricing"* (<https://cloud.google.com/functions/pricing-overview>). Identical
billing, no advantage, and a worse fit: MCP needs one path handling POST and GET with full header
control. Deploy a container.

### Egress

1 GiB/month free within North America, then $0.12/GiB
(<https://cloud.google.com/vpc/network-pricing>). 50,000 JSON-RPC responses would need to average
~21 KiB each to exhaust it. **$0.**

---

## 3. Event landing

**Cost does not decide this.** Three of the four candidates are exactly $0 at both volumes with
zero idle cost. Assuming a ~1 KB JSON event, 50,000/month is **~48.8 MiB**.

| Sink | 1,000/mo | 50,000/mo | Idle | Free tier, and how much headroom |
|---|---|---|---|---|
| **Cloud Logging (stdout)** | **$0.00** | **$0.00** | **$0.00** | 50 GiB/**project**/mo → ~0.1% used; ~52M events before the first cent |
| **BigQuery** (Storage Write API *or* batch load) | **$0.00** | **$0.00** | **$0.00** | Write API 2 TiB/mo free; batch load free outright; 10 GiB storage free |
| **Firestore** (Native, Standard, default DB) | **$0.00** | **$0.00** | **$0.00** | 20,000 writes/**day** → ~8% used at 1,667/day |
| Pub/Sub → BigQuery subscription | ~$0.00005 | ~$0.0023 | $0.00 | 10 GiB/mo free **excludes** the BigQuery-subscription leg |

Nothing here charges a storage minimum or a per-hour fee. There is no always-idle cost in any of
the four — which is worth stating plainly, since the question asked which ones charge nothing while
idle: **all four are $0 idle.** The differentiators are latency, setup burden, and one billing trap.

### Cloud Logging — recommended

**$0.50/GiB, first 50 GiB per project per month free.** Log Router: *"No additional charge"*.
Log Analytics: *"No additional charge"*. 30-day default retention free; only logs kept **beyond**
30 days cost $0.01/GiB-month. The `_Required` bucket is free and non-configurable. Volume counts
*"the actual size of the log entries prior to indexing"* — **no minimum entry size**.
Source: <https://cloud.google.com/stackdriver/pricing> (checked 2026-08-03).

The decisive property is architectural, not financial — see Appendix C. Cloud Run captures stdout
with no client library and no API call, parsing a serialized JSON line into `jsonPayload`, and this
path *"doesn't consume quota for `entries.write` requests"*
(<https://docs.cloud.google.com/run/docs/logging>). Every other sink puts a network round trip
inside the billed request window.

**Log Analytics probably removes the need for BigQuery entirely.** From
<https://docs.cloud.google.com/logging/docs/log-analytics> (now branded *Observability Analytics*):

> **There are no BigQuery ingestion or storage costs** when you upgrade a bucket to use
> Observability Analytics and then create a linked BigQuery dataset. When you create a linked
> BigQuery dataset for a log bucket, you don't ingest your log data into BigQuery. Instead, you get
> read access to the log data stored in your log bucket through the linked BigQuery dataset.

So you get SQL over telemetry with **no export pipeline and no duplicate storage**. SQL from the Log
Analytics UI is free; the same SQL through BigQuery Studio/API/`bq` bills on-demand query bytes
against the 1 TiB/month free allowance.

> ⚠️ **The double-charge trap.** *"if a log entry is routed to three log buckets that are in the
> same project, then that project is charged three times for the log entry."* If you later add a
> sink to BigQuery **and** leave `_Default` enabled, you pay Logging ingestion *and* BigQuery. Add
> an exclusion filter on `_Default` if you ever do that. At 0.1% of free tier this is theoretical
> here, but it is the mistake to avoid.

**Limitation to accept:** 30-day default retention. For a v1 whose MLOps consumer is explicitly
designed-not-built (#1), 30 days is enough, and extending is $0.01/GiB-month. If durable history
becomes real, add a BigQuery sink then — it is an additive change, not a migration.

### BigQuery — the right escalation, and one path to avoid

Free tier: **10 GiB storage/month, 1 TiB queries/month**, *"available during and after the free
trial period"*. On-demand queries $6.25/TiB. Storage is *"prorated per MiB, per second"* with no
dataset minimum. Source: <https://cloud.google.com/bigquery/pricing> (checked 2026-08-03).

The three ingestion paths are **not** equivalent:

| Path | Price | Free tier |
|---|---|---|
| **Batch load** | *"Free using the shared slot pool named default-pipeline"* | free outright |
| **Storage Write API** | $0.025/GiB | **first 2 TiB/month free** |
| Legacy streaming `tabledata.insertAll` | $0.010 per 200 MiB, *"1 KB minimum size"* per row | **none** |

**Use the Storage Write API or batch load; never `insertAll`.** It is the one path with no free
tier, and its 1 KB per-row minimum penalises exactly this event shape. Even so it would only be
$0.0024/month — the reason to avoid it is that it is the strictly worse option, not the cost.

> ⚠️ Active **logical** storage now reads **$0.023/GiB-month** and long-term logical
> **$0.016** — above the long-familiar $0.02/$0.01. The page's own worked example confirms it
> (*"For 1 TiB for a full month, you pay $23.552 USD"*), but its prose still claims long-term
> *"drops by approximately 50%"* when the table shows ~30%. **Internally inconsistent page.**
> Irrelevant at 50 MB, flagged for accuracy.

### Firestore — fine, with two silent traps

Free per **day**: 50,000 reads, 20,000 writes, 20,000 deletes; 1 GiB stored; 10 GiB/month egress.
At 1,667 writes/day you sit at ~8% of the write quota. Beyond free: $0.09/100,000 writes,
$0.15/GiB-month. No idle charge. Source: <https://cloud.google.com/firestore/pricing>.

The traps, both of which silently forfeit the free tier:

1. *"Firestore allows exactly one free database per project."* A **named** (non-default) database
   gets **no free quota** at all.
2. Firestore now splits into **Standard** and **Enterprise** editions with separate pricing pages,
   Enterprise being the MongoDB-compatible mode billed in units rather than operations
   (<https://cloud.google.com/firestore/enterprise/pricing>). Most secondary material conflates
   them. Stay on **Standard, default database**.

Reasonable if the access pattern were point lookups. It is not — telemetry is analytics — and it
still puts an API call in the request path.

### Pub/Sub → BigQuery — skip

Not for cost (~$0.0023/month) but because its billing model actively punishes this workload and it
adds two resources to operate for buffering that 1.15 requests/minute does not need.

- **The free tier does not apply**: *"BigQuery subscriptions cost $50 per TiB... **The first 10 GiB
  of BigQuery subscription throughput is not free.**"* It is the only candidate billing from byte
  one. (<https://cloud.google.com/pubsub/pricing>)
- **Minimum billable size** — and the common belief is subtly wrong in a way that matters:
  *"A minimum of 1 KB is assessed for **each request**, independent of the message sizes in the
  request."* The floor is **per publish request, not per message**. One event per publish means a
  2× penalty on a 500-byte event; batching 10 events into one request costs 1 KB total, not 10 KB.
  A separate footnote confirms "1 KB" here means **1,000 bytes**.
- Idle is genuinely $0 — no per-topic or per-subscription fee — provided retention is off and the
  backlog drains inside 24 h. Retained/acked/snapshotted messages cost $0.27/GiB-month.
- **Pub/Sub Lite is being turned down 2026-03-18.** Do not build on it.

---

## 4. The honest monthly bill

**Assumptions, stated so they can be argued with.** 1 vCPU / 512 MiB instance; ~150 ms warm
handler; ~2 s cold start; 1 KB telemetry event. "Requests" means MCP requests. Site page views are
modelled separately at the same volumes, because they drive a completely different line item.
The 2 s cold start is **my estimate, not a Google figure** (§2) — but §4.1 shows the bill is
insensitive to it.

### 4.1 Cloud Run — the arithmetic

Billable instance time = (cold starts × 2 s) + (requests × 0.15 s).

**At 1,000 requests/month** — traffic so sparse that most requests are cold; assume 800 cold starts:

```
instance time = 800 × 2 s + 1,000 × 0.15 s     = 1,750 s
vCPU-seconds  = 1,750 × 1                      = 1,750   (free: 180,000 -> 0.97% used)
GiB-seconds   = 1,750 × 0.5                    =   875   (free: 360,000 -> 0.24% used)
requests                                       = 1,000   (free: 2,000,000 -> 0.05%)
```

**At 50,000 requests/month** — ~1.15/min, so Google's up-to-15-min idle retention keeps it mostly
warm; assume 500 cold starts:

```
instance time = 500 × 2 s + 50,000 × 0.15 s    = 8,500 s
vCPU-seconds  = 8,500                          = 8,500   (free: 180,000 -> 4.72% used)
GiB-seconds   = 4,250                          = 4,250   (free: 360,000 -> 1.18% used)
requests                                       = 50,000  (free: 2,000,000 -> 2.50%)
```

**Both are $0.00.** To show the scale honestly, the *gross* cost if no free tier existed:

```
50,000 req:  8,500 × $0.000024  = $0.2040   CPU
             4,250 × $0.0000025 = $0.0106   memory
            50,000 × $0.0000004 = $0.0200   requests
                                  -------
                                  $0.2346   ~ $0.23/month gross
 1,000 req:                       $0.0446   ~ $0.045/month gross
```

The free tier is worth 180,000 × $0.000024 + 360,000 × $0.0000025 + 2M × $0.40/1M = **$6.02/month**,
about 26x the gross cost at 50,000 requests. You could be 25x wrong about cold starts or handler
duration and still pay nothing. *(All arithmetic in this section is mine, on Google's published
rates.)*

**Contrast — `min-instances=1` to eliminate cold starts:** 730 h = 2,628,000 s.

```
CPU:    2,628,000 × $0.0000025 = $6.57
memory: 1,314,000 × $0.0000025 = $3.29
                                 -----
                                 $9.86/month gross
```

Net after free tier is **between ~$4.64 and ~$8.51/month** depending on whether the allotment is
deducted as seconds or as dollars — the page says *"applied as a spending based discount using
Tier 1 pricing"*, which does not settle it. **UNCONFIRMED which.** Either way the conclusion holds:
this is the single decision that moves the bill from zero to several dollars a month, permanently,
to remove a sub-second wait on a hobby project's first request. **Don't.**

### 4.2 Site — the only place a real bill appears

Firebase Hosting: 10 GB/month transfer free, then $0.15/GB.

| Page views/mo | Page weight | Transfer | Over 10 GB | **Cost** | vs 360 MB/day cap |
|---|---|---|---|---|---|
| 1,000 | 300 KB | 0.3 GB | — | **$0.00** | 10 MB/day, ok |
| 1,000 | 1 MB | 1.0 GB | — | **$0.00** | 33 MB/day, ok |
| 50,000 | 300 KB | 15 GB | 5 GB | **$0.75** | 500 MB/day, **over** |
| 50,000 | 1 MB | 50 GB | 40 GB | **$6.00** | 1,667 MB/day, **over** |

Two things follow. First, **page weight is the whole lever** — a lean static blog at 300 KB costs
$0.75/month at 50k views where a 1 MB page costs $6.00. Second, at 50k views **the daily cap bites
before the monthly one**, which is precisely why the 360 MB/day vs 10 GB/month discrepancy flagged
in section 1 is not academic.

> **UNCONFIRMED:** what happens when the cap is hit. On Blaze it is presumably billed at $0.15/GB;
> on Spark a quota is presumably enforced (site unavailable until reset). I found no page stating
> the enforcement behaviour. Worth confirming before the site could plausibly get 1,600 views/day.

Same traffic on Cloud Storage + Cloud CDN + ALB, for comparison: $18.25 + 15 GB × $0.08 + lookups
= **$19.49/month** versus **$0.75**. 26x worse.

### 4.3 Events

50,000 × 1 KB = **~48.8 MiB/month**.

```
Cloud Logging:      48.8 MiB / 50 GiB free       = 0.10% of free tier  -> $0.00
BigQuery Write API: 48.8 MiB / 2 TiB free        = 0.002%              -> $0.00
Firestore:          1,667/day / 20,000 per day   = 8.3%                -> $0.00
Pub/Sub -> BQ:      0.0000466 TiB × $50/TiB      = no free tier        -> $0.0023
```

### 4.4 Artifact Registry — the line that grows while you sleep

**0.5 GiB free per billing account**, then $0.000136986/GiB-hour = **$0.10/GiB-month**
(<https://cloud.google.com/artifact-registry/pricing>). Source deploys auto-create a
`cloud-run-source-deploy` repo, and **every deploy pushes a new image that is retained forever
unless deleted.** Buildpack images are not small.

| Images retained | Size | Billable | **Cost/month** |
|---|---|---|---|
| 2 | 0.59 GiB | 0.09 GiB | $0.01 |
| 10 | 2.93 GiB | 2.43 GiB | $0.24 |
| 20 | 5.86 GiB | 5.36 GiB | $0.54 |
| 20 @500 MB each | 9.77 GiB | 9.27 GiB | $0.93 |

Trivial in absolute terms, but it is **the only cost here that rises monotonically with no traffic
at all**, and the free tier is shared across the whole billing account. Google flags the trap
itself: *"if you... exceed the Artifact Registry free tier usage, you will incur charges for
deploying your functions, even when your use of Cloud Run falls within the free tier."*
**Set a cleanup policy on day one.**

### 4.5 Totals

| Combination | @1,000 req + 1,000 views | @50,000 req + 50,000 views (300 KB pages) |
|---|---|---|
| **Firebase Hosting + Cloud Run + Cloud Logging** (recommended) | **$0.01** | **$0.99** ($0.75 site + $0.24 registry) |
| Firebase Hosting + Cloud Run + BigQuery (Write API) | $0.01 | $0.99 |
| Firebase Hosting + Cloud Run + Firestore | $0.01 | $0.99 |
| Firebase Hosting + Cloud Run + Pub/Sub to BigQuery | $0.01 | $0.99 |
| GCS + Cloud CDN + ALB + Cloud Run + Cloud Logging | **$18.26** | **$19.73** |
| Firebase Hosting + Cloud Run `min-instances=1` + Logging | **$4.65-8.52** | **$5.63-9.50** |

The event sink is worth **less than a third of a cent** across the whole range — which is exactly
why it should be chosen on latency and operational simplicity (section 3, Appendix C), not on
price. The $18.25 load balancer and the $9.86 warm instance are the only decisions with real money
attached, and both are avoidable.

---

## 5. Build and deploy

### Cloud Build

**2,500 free build-minutes per month**, and the shape has changed from what most material says:
the free tier is for machine type **`e2-standard-2`** in the **default pool** — not e2-medium, not
n1-standard-1 — and it is **per month, not per day**. A release note dated **September 1, 2023**
records the change away from the old daily allocation. Beyond free: **$0.006/min** on e2-standard-2
($0.003 on e2-medium). First 100 GB SSD free. Private pools get **no** free tier.
Sources: <https://cloud.google.com/build/pricing>,
<https://docs.cloud.google.com/build/release-notes> (checked 2026-08-03).

**No idle cost:** *"A build-minute is incurred every minute that a build is in process"* and
*"Build-minutes are not incurred for the time that a build is queued."*

At ~3 min per Node buildpack build, **20 deploys/month = ~60 min = 2.4% of the free tier.** $0.

> The Firebase pricing page still advertises *"Cloud Build minutes — No-cost up to 120 min/day"*
> under Cloud Functions, contradicting the Cloud Build page's 2,500 min/month. Both live
> 2026-08-03. The Cloud Build page plus its dated release note is the newer, authoritative
> statement; **the Firebase page appears stale.** Don't plan around 120 min/day.

### Deploying without local Docker — viable, confirmed

**Yes.** `gcloud run deploy --source .` builds remotely: *"This option uses Google Cloud's
buildpacks and Cloud Build to automatically build container images from your source code."* No
local daemon. And no Dockerfile is required: *"If no Dockerfile is present in the source code
directory, Google Cloud's buildpacks automatically detects the language."*
(<https://docs.cloud.google.com/run/docs/deploying-source-code>)

The Node buildpack supports *"the Current and Active LTS releases of Node.js"*, honours
`engines.node` in `package.json`, and runs `scripts.start` (or `npm start`)
(<https://docs.cloud.google.com/docs/buildpacks/nodejs>). Note the tension with the section 2 tip
to avoid `npm start` — a `Procfile` resolves it, and Google recommends one because *"it takes the
package manager out of the path."*

Source deploys use the default pool with the default machine type, which is `e2-standard-2` — the
exact type the free tier covers. **Derived, not directly stated:** no single Google sentence says
"source deploys bill against the Cloud Build free tier"; this chains three sourced facts. High
confidence, but labelled.

### Getting there with no gcloud, no Docker, no Terraform

Ranked by setup burden for a machine with only Node 22.14 / npm 11.6.2:

1. **Cloud Shell** — zero install. Free, gcloud + Docker + Node + git preinstalled, 5 GB persistent
   `$HOME`. Limits: **50 h/week**, 12 h session cap, `$HOME` deleted after **120 days** of
   non-access. *(Two Google pages disagree on the idle timeout — the limitations page says 40
   minutes, "how it works" says an hour. Assume the shorter.)*
   <https://docs.cloud.google.com/shell/docs/limitations>
2. **Console repo-connect** — Cloud Run, Connect repo, Cloud Build, Buildpacks; push to `main`
   redeploys. No local tooling, no Dockerfile.
   <https://docs.cloud.google.com/run/docs/quickstarts/deploy-continuously>
3. **GitHub Actions + Workload Identity Federation** — official Google-maintained
   `google-github-actions/auth` + `deploy-cloudrun`, keyless. WIF *"eliminates the maintenance and
   security burden associated with service account keys."*
   <https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines>
4. **`npm i -g firebase-tools`** — the one CLI installable with the tooling already present
   (requires Node >= 18). Deploys **Hosting**; it does **not** deploy Cloud Run.
5. **gcloud locally** — **no npm package exists.** macOS install is a tarball + `install.sh`, or a
   self-contained versioned archive needing no root. Requires **Python 3.10-3.14**; the macOS
   archives are not Python-bundled. <https://docs.cloud.google.com/sdk/docs/install>

**Recommended path:** Cloud Shell for one-time bootstrap (project, APIs, IAM, first deploy), then a
console-configured Cloud Build GitHub trigger for ongoing deploys, and `firebase-tools` locally for
the site. Nothing needs installing on the laptop except an npm package.

### The gate, and the absence of a hard cap

- **$300 credit, 90 days.** *"The Google Cloud Free Trial is a 90-day program."*
- **A credit card is required at signup**, and **a billing account is required even for Always
  Free**: *"A Google Cloud billing account is required to access the Google Cloud Free Tier."*
  **There is no way to run Cloud Run or Cloud Build without attaching a payment method.**
- **No auto-charge at trial end.** *"If you don't upgrade to a Paid billing account before 90 days
  pass... your Free Trial billing account will be closed and all of its associated projects and
  resources will be stopped."* Risk begins only after you voluntarily upgrade.
- **Always Free survives the trial** — *"available during and after the free trial period"* — but
  Google *"reserves the right to change the offering... with 30 days' advance notice."*
- **There is no hard spend cap.** Budgets alert; they do not enforce. Google's documented
  mitigation is budget to Pub/Sub to a function that disables billing, and Google states plainly:
  ***"Following the steps in this example doesn't guarantee that you won't spend more than your
  budget."*** It also warns the kill-switch *"terminates all Google Cloud services in the project,
  including Free Tier services"* and *"Resources might be irretrievably deleted."*
  <https://docs.cloud.google.com/billing/docs/how-to/disable-billing-with-notifications>

**Practical mitigation here:** a low budget alert (e.g. $5) plus `--max-instances`. The blast radius
is genuinely small — the only unbounded line is site bandwidth at $0.15/GB, so even a viral post is
tens of dollars, not thousands.

> **For [#6](https://github.com/wzrd-nvr/bag-of-beans/issues/6):** the "Docker installed" checklist
> item can be closed as **not required** — Cloud Build substitutes fully via source deploys.
> Suggested region **us-central1**: Tier 1 for Cloud Run, and one of the three regions where the
> Cloud Storage free tier applies.

---

## Appendix A — what the MCP spec forces on the deployment

Checked against MCP specification 2025-11-25, `basic/transports`
(<https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>), 2026-08-03. This
determines whether the service can be stateless, which determines whether scale-to-zero is viable
at all.

**The endpoint must accept POST and GET — but GET may be refused.**

> The server **MUST** provide a single HTTP endpoint path (hereafter referred to as the **MCP
> endpoint**) that supports both POST and GET methods.

> The server **MUST** either return `Content-Type: text/event-stream` in response to this HTTP GET,
> or else return HTTP 405 Method Not Allowed, indicating that the server does not offer an SSE
> stream at this endpoint.

**Returning 405 on GET is spec-compliant.** The map's "skip SSE in v1" is not a conformance
shortcut — it is an explicitly sanctioned server profile.

**POST responses may be plain JSON.**

> If the input is a JSON-RPC *request*, the server **MUST** either return `Content-Type:
> text/event-stream`, to initiate an SSE stream, or `Content-Type: application/json`, to return one
> JSON object. The client **MUST** support both these cases.

Answering every POST with `application/json` is conformant and clients are required to cope. This
keeps requests short, which is why the Cloud Run timeout is a non-issue rather than a tuning
problem.

**Sessions are optional, and declining them is what makes scale-to-zero safe.**

> A server using the Streamable HTTP transport **MAY** assign a session ID at initialization time,
> by including it in an `MCP-Session-Id` header on the HTTP response containing the
> `InitializeResult`.

`MAY`. A server that never issues `MCP-Session-Id` holds no per-client state, so any request may
land on any instance. **Take this option** — see Appendix B.

**Two obligations easy to miss:**

- `MCP-Protocol-Version` — the client **MUST** send it on all post-initialization requests; the
  server **MUST** respond `400 Bad Request` to an invalid or unsupported value; absent the header
  the server **SHOULD** assume `2025-03-26`.
- Origin validation — *"Servers **MUST** validate the `Origin` header on all incoming connections
  to prevent DNS rebinding attacks... servers **MUST** respond with HTTP 403 Forbidden."* This
  applies to a public Cloud Run deployment, not only to localhost.

## Appendix B — why the service must be stateless, in Cloud Run's own words

If the server issued `MCP-Session-Id`, later requests would need to reach the instance holding that
session. Cloud Run's mechanism for that is session affinity, documented as **best-effort only**
(<https://cloud.google.com/run/docs/configuring/session-affinity>, checked 2026-08-03):

> Due to the autoscaling behavior of Cloud Run, session affinity is best effort affinity.

> If the instance is terminated for any reason, or reaches maximum request concurrency or maximum
> CPU utilization, then session affinity is broken and further requests are routed to a different
> instance.

> Although you can cache client session data in memory of instances, you cannot assume that a
> client will always reconnect to the same instance, even when session affinity is enabled.

Under `min-instances=0` the instance is terminated on *every* idle period, so affinity would break
constantly by design. The request-timeout page says the same from another angle: *"When a client
re-connects... the client isn't guaranteed to connect to the same instance of the service."*

Making sessions reliable would need an external session store, and the cheap option there
(Memorystore) is provisioned by the hour — a permanent idle cost, which the standing constraints
rule out.

**Conclusion: build the MCP adapter stateless** — no `MCP-Session-Id`, 405 on GET,
`application/json` on POST. Scale-to-zero then costs nothing in correctness, and concurrency can be
left at its default.

## Appendix C — the telemetry write is on the critical path, which picks the sink

Cloud Run's general tips (<https://cloud.google.com/run/docs/tips/general>, checked 2026-08-03) are
explicit that under request-based billing you cannot defer work past the response:

> when the Cloud Run service finishes handling a request, the instance's access to CPU will be
> disabled or severely limited.

> You shouldn't start background threads or routines that run outside the scope of the request
> handlers if you use this type of billing.

> Running background threads with request-based billing enabled can result in unexpected behavior
> because any subsequent request to the same container instance resumes any suspended background
> activity.

The tempting pattern — respond first, flush telemetry after — is therefore unavailable unless the
service switches to instance-based billing, which defeats scale-to-zero. **The telemetry write sits
on the critical path of every request**, so the sink's write latency is added to every MCP call and
billed as vCPU-seconds.

That is what separates otherwise-identical $0 options. Firestore, BigQuery and Pub/Sub are each
reached by an API call, putting a network round trip inside the billed window. Writing a line of
JSON to stdout does not: Cloud Run's logging doc
(<https://docs.cloud.google.com/run/docs/logging>, checked 2026-08-03) confirms the capture is
out-of-band and that a serialized JSON line becomes structured data:

> you can send a simple text string or send a single line of serialized JSON, also called
> "structured" data. This is picked up and parsed by Cloud Logging and is placed into `jsonPayload`

Special fields (`severity`, `message`, `logging.googleapis.com/trace`) are lifted out of the
payload into the `LogEntry`. The doc notes this path *"doesn't consume quota for `entries.write`
requests"* and that *"Most developers are expected to write logs using standard output and standard
error"*, with client libraries recommended only for *"higher volume or reliability"* needs.

The `channel` dimension the map requires (`mcp` / `web` / `marketplace`) is just a field in that
JSON object, queryable in Log Analytics with no schema migration.

## Appendix D — Bearer auth storage

The map specifies Bearer auth on the MCP endpoint, implying somewhere to keep a token. Secret
Manager's free tier covers it: **six active secret versions** and **10,000 access operations per
month**, aggregated across projects by billing account. Billing for active versions is prorated by
time active, and management operations (create, destroy, change state) are not billed.
Sources: <https://cloud.google.com/secret-manager/pricing>,
<https://docs.cloud.google.com/free/docs/free-cloud-features> (checked 2026-08-03).

One token sits well inside six versions and 10,000 accesses. **$0.**

**UNCONFIRMED:** the per-version and per-10,000-operation rates beyond the free tier — the pricing
page body truncated on fetch and I could not read the rate table. Does not affect the
recommendation.

---

## Everything flagged UNCONFIRMED

1. **Firebase Hosting free transfer window** — pricing page says 360 MB/day, quotas doc says
   10 GB/month. Two live official pages disagree on the enforcement basis. Material at 50k views.
2. **What happens when the Hosting transfer cap is hit** — billed on Blaze vs quota-enforced on
   Spark. No page states the behaviour.
3. **Firebase Hosting's default `Cache-Control` for static assets** — only implied by a code
   comment ("default 1 hour browser cache"), never stated as a header value.
4. **Whether Firebase Hosting imposes its own timeout or body-size limit on rewrites to Cloud Run.**
   Relevant if SSE is ever enabled. `*.run.app` is the bypass.
5. **Cold-start latency for a Node container** — Google publishes no figure anywhere in its docs.
   The 2 s used in section 4 is my estimate. Measure it after the first deploy.
6. **Whether the Cloud Run free tier is deducted as seconds or as dollars** — decides whether
   `min-instances=1` nets $4.64 or $8.51/month. Immaterial at `min-instances=0`.
7. **That source deploys bill against the Cloud Build free tier** — derived by chaining three
   sourced facts, not stated in any single sentence.
8. **Secret Manager rates beyond the free tier** — pricing page truncated on fetch.
9. **Cloud Shell idle timeout** — 40 minutes vs 1 hour across two Google pages.
10. **Firestore free-tier region restrictions** — none stated, but that is an absence of a
    restriction rather than an affirmative statement that all locations qualify.
11. **Classic Compute Engine managed SSL certs being free** — inferred from the absence of a SKU.
    (Certificate Manager's free-to-100 tier *is* explicit.)
12. **Cloud Run implicit default startup probe parameters** when none is configured — not
    documented.

## Notable changes worth knowing

- **Cloud Build free tier** is 2,500 min/month on `e2-standard-2` (since 2023-09-01), not the
  widely-repeated 120 min/day on n1-standard-1. The Firebase pricing page still shows the old
  figure.
- **BigQuery active logical storage** now reads $0.023/GiB-month and long-term logical $0.016 —
  above the familiar $0.02/$0.01. That page's prose and its table are internally inconsistent.
- **Firestore has split** into Standard and Enterprise editions with separate pricing pages;
  Enterprise is the MongoDB-compatible mode, billed in units rather than operations.
- **Pub/Sub Lite turns down 2026-03-18.**
- **Cloud Run domain mappings remain Preview**, and Google says they are "not production-ready".
- **"Cloud Functions" is now "Cloud Run functions"** and bills identically to Cloud Run.
- **Google Cloud Starter Tier** is new — a no-credit-card managed tier provisioned via AI Studio.
  Separate from Always Free; not a fit for a self-managed MCP server, but worth knowing it exists.
- **Docs moved** to `docs.cloud.google.com`; `/pricing` pages stayed on `cloud.google.com`.

## Open questions this raises for other tickets

- **[#4](https://github.com/wzrd-nvr/bag-of-beans/issues/4)** (one repo or two) — the Cloud Build
  GitHub trigger and the Firebase Hosting deploy are separate pipelines. Cheap either way, but a
  monorepo needs path-filtered triggers so that publishing a blog post does not rebuild the
  container and add another image to Artifact Registry.
- **[#13](https://github.com/wzrd-nvr/bag-of-beans/issues/13)** (telemetry schema) — if the sink is
  a log line, the schema is a TypeScript type and a JSON shape, with no table DDL and no migration
  path. That materially simplifies the ticket. The 30-day retention default is the constraint to
  design against.
- **[#3](https://github.com/wzrd-nvr/bag-of-beans/issues/3)** (one core, two adapters) — Appendices
  A-C are effectively requirements on the MCP adapter: stateless, 405 on GET, `application/json` on
  POST, Origin validation, and an awaited rather than deferred telemetry write.
