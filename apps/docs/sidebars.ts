import type { SidebarsConfig } from "@docusaurus/plugin-content-docs";

const sidebars: SidebarsConfig = {
  mainSidebar: [
    "intro",
    "quickstart",
    "user-flow",
    "going-live",
    {
      type: "category",
      label: "Built on aomi",
      collapsed: false,
      items: ["how-aomi-fits", "extending"],
    },
    "architecture",
    {
      type: "category",
      label: "Concepts",
      collapsed: false,
      items: [
        "concepts/arbitrage-101",
        "concepts/correlation-groups",
        "concepts/non-custodial-autopilot",
        "concepts/policy-as-code",
      ],
    },
    "policy-language",
    "api-reference",
    "tradeoffs",
    "deployment",
  ],
};

export default sidebars;
