// tests/dag-executor.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { dagTopological, dagUniqueRepos, dagFanInRepos } from "../src/core/dag.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("dagTopological", () => {
  it("single node, no edges → wave 1", () => {
    expect(dagTopological([], ["1"])).toEqual(["1\t1"]);
  });
  it("linear chain 1->2->3 → three waves", () => {
    const edges: Array<[string, string]> = [["1", "2"], ["2", "3"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toEqual(["1\t1", "2\t2", "3\t3"]);
  });
  it("diamond 1->2, 1->3, 2->4, 3->4 → waves 1 / 2 (2,3) / 3 (4)", () => {
    const edges: Array<[string, string]> = [["1", "2"], ["1", "3"], ["2", "4"], ["3", "4"]];
    expect(dagTopological(edges, ["1", "2", "3", "4"])).toEqual(["1\t1", "2\t2", "2\t3", "3\t4"]);
  });
  it("intra-wave order is NUMERIC ascending, not lexical (10 after 2)", () => {
    expect(dagTopological([], ["10", "2", "1"])).toEqual(["1\t1", "1\t2", "1\t10"]);
  });
  it("node arg order does not affect numeric intra-wave sort", () => {
    expect(dagTopological([], ["3", "1", "2"])).toEqual(["1\t1", "1\t2", "1\t3"]);
  });
  it("cycle 1->2->1 → null + exact stderr diagnostic", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const edges: Array<[string, string]> = [["1", "2"], ["2", "1"]];
    expect(dagTopological(edges, ["1", "2"])).toBeNull();
    expect(spy).toHaveBeenCalledWith("dagTopological: cycle detected (no zero-indegree nodes left, 0/2 processed)\n");
  });
  it("partial cycle reports k/n with k>0 (root 1 emitted, 2<->3 cycle)", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const edges: Array<[string, string]> = [["1", "2"], ["2", "3"], ["3", "2"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toBeNull();
    expect(spy).toHaveBeenCalledWith("dagTopological: cycle detected (no zero-indegree nodes left, 1/3 processed)\n");
  });
  it("edges with empty endpoints are ignored (byte-faithful -n guard)", () => {
    const edges: Array<[string, string]> = [["", "2"], ["1", ""]];
    expect(dagTopological(edges, ["1", "2"])).toEqual(["1\t1", "1\t2"]);
  });
  it("fan-in: 1->3, 2->3 resolves once both parents clear", () => {
    const edges: Array<[string, string]> = [["1", "3"], ["2", "3"]];
    expect(dagTopological(edges, ["1", "2", "3"])).toEqual(["1\t1", "1\t2", "2\t3"]);
  });
  it("empty nodes → empty result, no cycle, no stderr", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(dagTopological([], [])).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("dagUniqueRepos", () => {
  it("unique column-3 repos sorted ascending", () => {
    const waves = "1\t1\tweb\t/srv/web\tbuild\n1\t2\tapi\tnone\tship\n2\t3\tweb\tnone\twire\n";
    expect(dagUniqueRepos(waves)).toEqual(["api", "web"]);
  });
  it("sort is C-locale code-unit order (uppercase before lowercase)", () => {
    const waves = "1\t1\tZeta\tnone\tx\n1\t2\talpha\tnone\ty\n";
    expect(dagUniqueRepos(waves)).toEqual(["Zeta", "alpha"]);
  });
  it("trailing newline does not introduce a phantom empty repo", () => {
    expect(dagUniqueRepos("1\t1\tapi\tnone\tbuild\n")).toEqual(["api"]);
  });
  it("a short (<3-field) row contributes the empty string like awk $3", () => {
    expect(dagUniqueRepos("1\t1\n1\t2\tapi\tnone\tbuild\n")).toEqual(["", "api"]);
  });
  it("empty input → empty list", () => { expect(dagUniqueRepos("")).toEqual([]); });
});

describe("dagFanInRepos", () => {
  it("only repos whose step has >=2 incoming edges, in waves row order", () => {
    const edges = "1\t2\n1\t3\n2\t3\n";
    const waves = "1\t1\troot\tnone\ta\n1\t2\tmid\tnone\tb\n2\t3\tsink\tnone\tc\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["sink"]);
  });
  it("a repo with exactly one incoming edge is excluded", () => {
    expect(dagFanInRepos("1\t2\n", "1\t1\troot\tnone\ta\n2\t2\tleaf\tnone\tb\n")).toEqual([]);
  });
  it("preserves waves row order and does NOT de-dupe repeated repos", () => {
    const edges = "1\t2\n4\t2\n1\t3\n5\t3\n";
    const waves = "1\t1\troot\tnone\ta\n2\t2\tshared\tnone\tb\n2\t3\tshared\tnone\tc\n1\t4\tx\tnone\td\n1\t5\ty\tnone\te\n";
    expect(dagFanInRepos(edges, waves)).toEqual(["shared", "shared"]);
  });
  it("edge with empty `to` is ignored (byte-faithful -n guard)", () => {
    expect(dagFanInRepos("1\t\n2\t3\n4\t3\n", "1\t1\troot\tnone\ta\n2\t3\tsink\tnone\tb\n")).toEqual(["sink"]);
  });
  it("empty waves row (trailing newline) is skipped via empty step guard", () => {
    expect(dagFanInRepos("1\t3\n2\t3\n", "1\t3\tsink\tnone\tb\n")).toEqual(["sink"]);
  });
  it("step absent from edges defaults to indegree 0 (excluded)", () => {
    expect(dagFanInRepos("1\t2\n", "1\t9\torphan\tnone\tz\n")).toEqual([]);
  });
});
