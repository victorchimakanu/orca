import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import { themes as prismThemes } from "prism-react-renderer";

const config: Config = {
  title: "Orca",
  tagline: "Observe · Reason · Correlate · Act",
  favicon: "img/orca-logo.jpg",

  url: "https://orca.local",
  baseUrl: "/",

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/",
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: "Orca",
      logo: { alt: "Orca logo", src: "img/orca-logo.jpg" },
      items: [
        { type: "docSidebar", sidebarId: "mainSidebar", position: "left", label: "Docs" },
        { href: "https://youtu.be/b8aPweQHPL0", label: "▶ Demo", position: "right" },
        { href: "https://github.com/aomi-labs", label: "aomi-labs", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      copyright: "Built on aomi-labs · Polymarket is a trademark of its respective owner.",
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
