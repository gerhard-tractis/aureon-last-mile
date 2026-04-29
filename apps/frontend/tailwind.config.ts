import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      screens: {
        tablet: '769px',
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "serif"],
        manifest: ["var(--font-manifest)", "var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        // shadcn compatibility — components use rounded-lg, rounded-md, rounded-sm
        // These must stay as var(--radius) derivatives; --radius is set per mode in globals.css
        lg:  "var(--radius)",
        md:  "calc(var(--radius) - 2px)",
        sm:  "calc(var(--radius) - 4px)",
        xl:  "12px",
      },
      colors: {
        /* ---- Semantic design system tokens ---- */
        background:   "var(--color-background)",
        surface: {
          DEFAULT: "var(--color-surface)",
          raised:  "var(--color-surface-raised)",
        },
        border:       "var(--color-border)",
        "border-subtle": "var(--color-border-subtle)",
        accent: {
          DEFAULT:    "var(--color-accent)",
          light:      "var(--color-accent-light)",
          muted:      "var(--color-accent-muted)",
          foreground: "var(--color-accent-foreground)",
        },
        text: {
          DEFAULT:    "var(--color-text)",
          secondary:  "var(--color-text-secondary)",
          muted:      "var(--color-text-muted)",
        },
        status: {
          success:          "var(--color-status-success)",
          "success-bg":     "var(--color-status-success-bg)",
          "success-border": "var(--color-status-success-border)",
          warning:          "var(--color-status-warning)",
          "warning-bg":     "var(--color-status-warning-bg)",
          "warning-border": "var(--color-status-warning-border)",
          error:            "var(--color-status-error)",
          "error-bg":       "var(--color-status-error-bg)",
          "error-border":   "var(--color-status-error-border)",
          info:             "var(--color-status-info)",
          "info-bg":        "var(--color-status-info-bg)",
          "info-border":    "var(--color-status-info-border)",
        },

        /* ---- Sidebar — always dark ---- */
        sidebar: {
          DEFAULT:    "var(--color-sidebar-bg)",
          text:       "var(--color-sidebar-text)",
          active:     "var(--color-sidebar-text-active)",
          hover:      "var(--color-sidebar-hover)",
          section:    "var(--color-sidebar-section)",
          border:     "var(--color-sidebar-border)",
        },

        /* ---- shadcn/ui compatibility — do not remove ---- */
        foreground:  "hsl(var(--foreground))",
        card: {
          DEFAULT:    "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT:    "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT:    "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT:    "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT:    "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        destructive: {
          DEFAULT:    "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        input:       "hsl(var(--input))",
        ring:        "hsl(var(--ring))",
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
          "4": "hsl(var(--chart-4))",
          "5": "hsl(var(--chart-5))",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
