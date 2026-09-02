# Cloud hardware for the exhaustive cribbage builder

Date: 2026-08-31

Scope: current repository source plus first-party AWS, Lambda, and NVIDIA
documentation. Prices are Linux On-Demand/list prices observed on 2026-08-31,
before storage, tax, or data-transfer charges. Capacity is not guaranteed.

## Conclusion

The current builder is a CPU program, so the lowest-risk way to compress wall
time is to run many deterministic shards on high-core-count CPU instances. The
best first AWS candidate is `hpc8a.96xlarge`: 192 physical AMD EPYC 9R45 cores,
768 GiB RAM, and no SMT for $7.92/hour in US East (Ohio). `c8a.48xlarge` offers
the same physical-core count and processor generation with 384 GiB RAM for
$10.34592/hour, is available in more regions, and supports Spot. A short pilot
on the production binary is still required because cloud throughput cannot be
derived reliably from core count or advertised maximum clock rate.

A GPU port is possible, but renting a GPU does not accelerate the current Rust
binary. The rollout/policy path uses per-world branching, variable-length
vectors, maps, and decision-local hidden-world evaluation. A useful GPU version
would be a separate batched, fixed-width kernel and deterministic reduction,
not a compiler switch. It should be prototyped on one GPU before purchasing a
large multi-GPU node.

## Why the job can scale across CPU nodes

The existing Model 13.2 builder accepts independent `--keep-start` and
`--keep-count` ranges. `scripts/run-model132-parallel-exhaustive.sh` launches
one process per range and merges completed shard assets afterward. The proposed
six-card, cut-averaged builder should retain that property by assigning
disjoint canonical six-card root ranges to workers. No cross-node communication
is needed during the expensive phase, so networking is not the limiting
resource; checkpoint frequency, shard balance, and final merge are the main
parallel-efficiency losses.

The present rollout is not GPU code. `build_model132_histograms.rs` calls
`rollout_model132_world` one compatible pair at a time. The policy adapter in
`model132.rs` uses `RefCell<Model91Policy>`, and the evaluation path uses
`Vec`, `HashMap`, and `BTreeMap` with data-dependent game histories and legal
action branches. Those structures would need to become compact fixed-size
arrays/bitfields and bounded loops in a GPU kernel.

## AWS CPU candidates

| Instance | CPU resources | RAM | Linux On-Demand, Ohio | 24-hour compute |
|---|---:|---:|---:|---:|
| `hpc8a.96xlarge` | 192 physical EPYC 9R45 cores, 1 thread/core, up to 4.5 GHz | 768 GiB | $7.92000/hour | $190.08 |
| `hpc7a.96xlarge` | 192 physical EPYC 9R14 cores, 1 thread/core, up to 3.7 GHz | 768 GiB | $7.20000/hour | $172.80 |
| `c8a.48xlarge` | 192 physical EPYC 9R45 cores, 1 thread/core, up to 4.5 GHz | 384 GiB | $10.34592/hour | $248.30 |
| `c7i.48xlarge` | 96 physical Sapphire Rapids cores, 2 threads/core (192 vCPUs) | 384 GiB | $8.56800/hour | $205.63 |

The source of truth for the quoted rates is AWS's public US East (Ohio) EC2
catalog, publication `2026-08-31T16:25:56Z`; its rows identify Linux, shared
tenancy, Used capacity, and the `RunInstances` operation:

- <https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/us-east-2/index.csv>
- AWS explains that On-Demand pricing is fixed per second and points to the
  pricing catalog: <https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-on-demand-instances.html>

Official specifications and availability:

- Hpc8a has 192 cores, 768 GiB, no SMT, and 300 Gbps EFA. AWS says it is
  available in Ohio and Stockholm and can be bought On-Demand or through a
  Savings Plan: <https://aws.amazon.com/about-aws/whats-new/2026/02/announcing-amazon-ec2-hpc8a-instances/>
- Hpc7a has 192 cores, 768 GiB, and no SMT. AWS documents its older 9R14
  processor and instance sizes here:
  <https://docs.aws.amazon.com/ec2/latest/instancetypes/hpc.html>
- C8a has 192 physical cores and 384 GiB at `48xlarge`, and supports
  On-Demand and Spot purchases:
  <https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html> and
  <https://aws.amazon.com/about-aws/whats-new/2025/12/compute-optimized-amazon-ec2-c8a-instances/>
- C7i has 192 vCPUs but only 96 physical cores because it exposes two threads
  per core: <https://docs.aws.amazon.com/ec2/latest/instancetypes/co.html>.
  It is therefore a less attractive first choice for a saturated,
  branch-heavy workload unless an actual pilot disproves that expectation.

`hpc8a` is the preferred first pilot. AWS reports up to 40% more performance
and up to 25% better price/performance than Hpc7a, but those are not guarantees
for this program. Benchmark both if the difference affects the node count.

## Converting the measured build rate into 24/48/72-hour hardware

Do not extrapolate from the Mac or an older build solely by GHz. Run a
representative production shard on one candidate instance and record:

- `W`: total production work units, preferably exact compatible worlds or
  completed canonical six-card roots;
- `r_node`: sustained work units per second from the pilot after warm-up;
- `e`: expected cluster efficiency after shard skew, checkpoints, and merge
  (`0 < e <= 1`);
- `D`: deadline in days (`1`, `2`, or `3`).

Then:

```text
nodes(D) = ceil(W / (r_node * 86,400 * D * e))
on-demand compute cost = nodes(D) * hourly_price * 24 * D
```

If the measurement is already a full one-node ETA `T_node` in hours:

```text
nodes(D) = ceil(T_node / (24 * D * e))
```

This formulation intentionally does not claim a required node count before a
cloud pilot supplies `r_node`. The existing range sharding makes 24-, 48-, and
72-hour targets an allocation question once that number is known.

## Capacity and operational caveats

- AWS's default quota for Running On-Demand HPC instances is zero and is
  adjustable. Request enough regional HPC vCPU quota before the run. Standard
  C-family On-Demand quota is separate and also defaults low for new accounts:
  <https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-quotas.html>.
- AWS notes that a supported instance type may not exist in every Availability
  Zone of a supported region:
  <https://docs.aws.amazon.com/ec2/latest/instancetypes/ec2-instance-regions.html>.
  Hpc8a is especially constrained to Ohio and Stockholm. Confirm launch
  capacity before committing to a deadline.
- AWS documents no Spot support for Hpc7a/Hpc8a. C8a supports Spot, but a
  deadline-sensitive estimate should use On-Demand unless the checkpointed
  supervisor is prepared for interruption and the capacity has been tested.
- Outputs are small relative to instance memory. Hpc EBS bandwidth is limited
  compared with general-purpose instances, but this builder's expensive phase
  is compute rather than streaming storage. Keep each shard's checkpoints on
  durable EBS and copy completed shards to object storage before termination.

## GPU option and current list pricing

Lambda's first-party On-Demand page currently lists:

| Lambda instance | Host resources | List price | 24-hour compute |
|---|---:|---:|---:|
| 1 x H100 PCIe 80 GB | 26 vCPUs, 225 GiB RAM, 1 TiB SSD | $3.29/GPU-hour | $78.96 |
| 8 x H100 SXM 80 GB | 208 vCPUs, 1,800 GiB RAM, 22 TiB SSD | $3.99/GPU-hour, or $31.92/node-hour | $766.08/node |

Source: <https://lambda.ai/instances>. Lambda labels self-serve instances as
first-come availability, so the listed hardware is not a capacity commitment.

GPU implementation shape:

1. Give each GPU thread (or a small cooperative group) one independent
   keep/world/cut rollout from a large batch.
2. Replace dynamic collections with fixed-width rank counts, packed history,
   and bounded stacks. Precompute legal-action/scoring tables.
3. Bucket similar states or workloads so threads in a warp follow similar
   control flow. NVIDIA explains that divergent warp branches are serialized:
   <https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/index.html#control-flow>.
4. Accumulate integer outcome counts/sums on device and perform a specified,
   stable reduction order. Compare a GPU sample byte-for-byte with CPU output
   before trusting a full asset.

The outer workload has enough independent items to occupy a GPU, so a speedup
is plausible. The inner rollout is branch-heavy and irregular, however, so no
credible GPU speedup factor or 24/48/72-hour GPU count exists until a real
kernel processes a representative sample. Start with the one-H100 Lambda
instance; an eight-H100 node is justified only after the prototype demonstrates
both single-GPU acceleration and near-linear multi-GPU sharding.
