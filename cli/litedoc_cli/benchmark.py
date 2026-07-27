import json
import sys
import time
from .engine import Engine

def cmd_benchmark(args) -> int:
    try:
        if not args.quiet and not args.json:
            print("litedoc: spinning up headless engine for benchmark...", file=sys.stderr)
        
        t0 = time.time()
        engine = Engine(quiet=args.quiet)
        spin_up = time.time() - t0
        
        # Invoke window.runBenchmark() if it exists, or run a synthetic loop
        result = engine._page.evaluate(
            """async (iters) => {
                if (typeof window.runBenchmark === 'function') {
                    return await window.runBenchmark(iters);
                } else {
                    return { error: 'window.runBenchmark is not defined in the app bundle.' };
                }
            }""",
            args.iterations
        )
        engine.close()

        if result.get("error"):
            print(f"litedoc benchmark error: {result['error']}", file=sys.stderr)
            return 1
            
        result["spin_up_time_s"] = spin_up

        if args.json:
            json.dump(result, sys.stdout, indent=2)
            sys.stdout.write("\n")
        else:
            print("========================================")
            print("LiteDoc Engine Benchmark")
            print("========================================")
            print(f"Spin-up Time : {spin_up:.3f} s")
            print(f"Iterations   : {args.iterations}")
            if "burst_ppt" in result:
                print(f"Burst PPT    : {result['burst_ppt']:.1f} Pages / Toast")
            if "sustained_ppm" in result:
                print(f"Sustained PPM: {result['sustained_ppm']:.1f} Pages / Minute")
            for k, v in result.items():
                if k not in ("error", "spin_up_time_s", "burst_ppt", "sustained_ppm"):
                    print(f"{k}: {v}")
            print("========================================")

        return 0
    except Exception as e:
        print(f"litedoc benchmark error: {e}", file=sys.stderr)
        return 1
