"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import * as d3Sankey from "d3-sankey";

// Color groups optimized for both light and dark mode
// Using colors that work well in both themes with good contrast
const getColorGroups = (isDark: boolean) => {
  if (isDark) {
    // Dark mode optimized colors - brighter, higher contrast
    return [
      ["ada", "#60d97c"],           // Brighter green for ADA
      ["unit", "#f4d03f"],          // Brighter yellow for units
      ["inaddr", "#5b9bd5"],        // Lighter blue for input addresses
      ["inutxo", "#9bb5e8"],        // Lighter blue for input UTxOs
      ["oututxo", "#f8a5c2"],       // Lighter pink for output UTxOs
      ["outaddr", "#f48fb1"],       // Lighter pink for output addresses
      ["burn", "#ff6b6b"],          // Bright red for burns
      ["mint", "#51cf66"],          // Bright green for mints
      ["collateral", "#b197fc"],    // Lighter purple for collateral
      ["fee", "#ff8787"],           // Bright red-pink for fees
      ["iutil", "#74c0fc"],         // Light blue for input utilities
      ["outil", "#74c0fc"],           // Light blue for output utilities
    ];
  } else {
    // Light mode colors - original with slight adjustments for better visibility
    return [
      ["ada", "#4b855e"],
      ["unit", "#ded09e"],
      ["inaddr", "#0130a7"],
      ["inutxo", "#87a4ed"],
      ["oututxo", "#f5e1e7"],
      ["outaddr", "#eb7a89"],
      ["burn", "#f70202"],
      ["mint", "#07fc03"],
      ["collateral", "#9022f7"],
      ["fee", "#f72274"],
      ["iutil", "#b5dde8"],
      ["outil", "#b5dde8"],
    ];
  }
};

interface TransactionJson {
  inputs?: Array<{
    txIn?: {
      txHash: string;
      txIndex: number;
      amount?: Array<{ unit: string; quantity: string }>;
      address?: string;
    };
  }>;
  outputs?: Array<{
    address: string;
    amount: Array<{ unit: string; quantity: string }>;
  }>;
  collaterals?: Array<{
    txIn?: {
      txHash: string;
      txIndex: number;
      amount?: Array<{ unit: string; quantity: string }>;
      address?: string;
    };
  }>;
  mints?: Array<{
    policyId?: string;
    mintValue?: Array<{ assetName?: string; amount: string }>;
  }>;
  fee?: string;
  changeAddress?: string;
}

type LinkStyle = 
  | "solid"           // Solid lines (default)
  | "dashed"          // Dashed lines
  | "dotted"          // Dotted lines
  | "gradient"        // Gradient from source to target (default for source-target)
  | "animated"        // Animated flowing effect
  | "thick"           // Thicker lines with higher opacity
  | "glow";           // Glowing effect with shadow

interface SankeyDiagramProps {
  transactionJson: TransactionJson | string;
  width?: number;
  height?: number;
  graphId?: string;
  /**
   * Optional custom color scheme. If provided, overrides automatic dark/light mode detection.
   * Format: Array of [nodeType, colorHex] pairs.
   * Example: [["ada", "#4b855e"], ["unit", "#ded09e"], ...]
   * Node types: ada, unit, inaddr, inutxo, oututxo, outaddr, burn, mint, collateral, fee, iutil, outil
   */
  customColors?: Array<[string, string]>;
  /**
   * Force dark mode colors (overrides system detection)
   */
  forceDarkMode?: boolean;
  /**
   * Force light mode colors (overrides system detection)
   */
  forceLightMode?: boolean;
  /**
   * Link style for connections
   * - "solid": Solid lines (default)
   * - "dashed": Dashed lines
   * - "dotted": Dotted lines
   * - "gradient": Gradient from source to target
   * - "animated": Animated flowing effect
   * - "thick": Thicker lines with higher opacity
   * - "glow": Glowing effect with shadow
   */
  linkStyle?: LinkStyle;
}

const makeLabel = (id: string): string => {
  const type = id.split("_")[0];
  const str = id.split("_").slice(1).join("_"); // Get everything after first underscore
  
  if (type === "inaddr" || type === "outaddr") {
    return str.length > 19 ? `${str.slice(0, 14)}...${str.slice(str.length - 5)}` : str;
  }
  if (type === "inutxo" || type === "oututxo") {
    return str.length > 13 ? `${str.slice(0, 5)}...${str.slice(str.length - 8)}` : str;
  }
  if (type === "ada") return "₳";
  if (type === "unit") {
    // For units, try to extract policyId and assetName if it's a hex string
    // Cardano native assets: unit = policyId (56 chars) + assetName (variable)
    if (str.length > 56) {
      const policyId = str.slice(0, 56);
      const assetNameHex = str.slice(56);
      // Try to decode asset name if it's ASCII
      let assetName = "";
      try {
        // Check if assetName is hex-encoded ASCII
        if (assetNameHex.length > 0 && assetNameHex.length % 2 === 0) {
          const bytes = [];
          for (let i = 0; i < assetNameHex.length; i += 2) {
            bytes.push(parseInt(assetNameHex.slice(i, i + 2), 16));
          }
          assetName = String.fromCharCode(...bytes.filter(b => b >= 32 && b <= 126));
          if (assetName.length > 0) {
            return `${assetName} (${policyId.slice(0, 8)}...)`;
          }
        }
      } catch (e) {
        // Fall through to default
      }
      // If decoding failed, show shortened version
      return `${policyId.slice(0, 8)}...${assetNameHex.slice(0, 4)}`;
    }
    // For shorter units, just truncate
    return str.length > 20 ? `${str.slice(0, 10)}...${str.slice(str.length - 6)}` : str;
  }
  return str || '';
};

const SankeyChart = ({
  nodes,
  links,
}: {
  nodes: Array<{ id: string }>;
  links: Array<{ source: string; target: string; value: number }>;
}, {
  format = ",",
  align = "justify",
  nodeId = (d: { id: string }) => d.id,
  nodeGroup = (d: { id: string }): string => d.id.split("_")[0] || '',
  nodeGroups = undefined as string[] | undefined,
  nodeLabel = (d: { id: string }): string => makeLabel(d.id),
  nodeTitle,
  nodeAlign = align,
  nodeWidth = 15,
  nodePadding = 18,
  nodeLabelPadding = 6,
  nodeStroke = "currentColor",
  nodeStrokeWidth = 1,
  nodeStrokeOpacity = 1,
  nodeStrokeLinejoin = "miter",
  linkSource = ({ source }: { source: string }) => source,
  linkTarget = ({ target }: { target: string }) => target,
  linkValue = ({ value }: { value: number }) => value,
  linkPath = d3Sankey.sankeyLinkHorizontal(),
  linkTitle,
  linkColor = "source-target",
  linkStrokeOpacity = 0.8,
  linkMixBlendMode = "multiply",
  colors = [] as string[],
  width = 800,
  height = 600,
  marginTop = 10,
  marginRight = 1,
  marginBottom = 10,
  marginLeft = 1,
  linkStyle = "solid" as LinkStyle,
}: {
  format?: string | ((d: number) => string);
  align?: string;
  nodeId?: (d: { id: string }) => string;
  nodeGroup?: (d: { id: string }) => string;
  nodeGroups?: string[];
  nodeLabel?: (d: { id: string }) => string;
  nodeTitle?: (d: { id: string; value: number }) => string;
  nodeAlign?: string | ((nodes: any) => void);
  nodeWidth?: number;
  nodePadding?: number;
  nodeLabelPadding?: number;
  nodeStroke?: string;
  nodeStrokeWidth?: number;
  nodeStrokeOpacity?: number;
  nodeStrokeLinejoin?: string;
  linkSource?: (d: { source: string }) => string;
  linkTarget?: (d: { target: string }) => string;
  linkValue?: (d: { value: number }) => number;
  linkPath?: any;
  linkTitle?: (d: { source: { id: string }; target: { id: string }; value: number }) => string;
  linkColor?: string;
  linkStrokeOpacity?: number;
  linkMixBlendMode?: string;
  colors?: string[];
  width?: number;
  height?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  linkStyle?: LinkStyle;
} = {}) => {
  // Convert format to a function early, before it's used in nodeTitle/linkTitle
  const formatFunc = typeof format !== "function" ? d3.format(format) : format;
  
  // Create default nodeTitle and linkTitle functions using formatFunc
  // These are used if nodeTitle/linkTitle are not provided
  const defaultNodeTitle = (d: { id: string; value: number }) => `${d.id}\n${formatFunc(d.value)}`;
  const defaultLinkTitle = (d: { source: { id: string }; target: { id: string }; value: number }) =>
    `${d.source.id} → ${d.target.id}\n${formatFunc(d.value)}`;
  
  // Use provided functions or defaults
  const nodeTitleFunc = nodeTitle ?? defaultNodeTitle;
  const linkTitleFunc = linkTitle ?? defaultLinkTitle;

  // Convert nodeAlign from a name to a function
  let nodeAlignFunc: any;
  if (typeof nodeAlign !== "function") {
    nodeAlignFunc = {
      left: d3Sankey.sankeyLeft,
      right: d3Sankey.sankeyRight,
      center: d3Sankey.sankeyCenter,
      justify: d3Sankey.sankeyJustify,
    }[nodeAlign] ?? d3Sankey.sankeyJustify;
  } else {
    nodeAlignFunc = nodeAlign;
  }

  // Compute values
  const LS = d3.map(links, linkSource).map(intern);
  const LT = d3.map(links, linkTarget).map(intern);
  const LV = d3.map(links, linkValue);
  const N = d3.map(nodes, nodeId).map(intern);
  const G = nodeGroup == null ? null : d3.map(nodes, nodeGroup).map(intern);

  // Replace the input nodes and links with mutable objects for the simulation
  const mutableNodes = d3.map(nodes, (_, i) => ({ id: N[i] }));
  const mutableLinks = d3.map(links, (_, i) => ({
    source: LS[i],
    target: LT[i],
    value: LV[i],
  }));

  // Ignore a group-based linkColor option if no groups are specified
  let finalLinkColor = linkColor;
  if (!G && ["source", "target", "source-target"].includes(linkColor)) {
    finalLinkColor = "currentColor";
  }

  // Compute default domains
  const finalNodeGroups = nodeGroups ?? (G ? Array.from(new Set(G)) : []);

  // Construct the scales - use provided colors or default
  const finalColors = colors.length > 0 ? colors : finalNodeGroups.map(() => '#888');
  const color = nodeGroup == null ? null : d3.scaleOrdinal(finalNodeGroups, finalColors);

  // Compute the Sankey layout
  const sankeyLayout = d3Sankey
    .sankey()
    .nodeId((node: any) => {
      const idx = mutableNodes.indexOf(node);
      return idx >= 0 ? N[idx] : '';
    })
    .nodeAlign(nodeAlignFunc)
    .nodeWidth(nodeWidth)
    .nodePadding(nodePadding)
    .extent([
      [marginLeft, marginTop],
      [width - marginRight, height - marginBottom],
    ]);
  
  sankeyLayout({ nodes: mutableNodes as any, links: mutableLinks as any });

  // Compute titles and labels using layout nodes
  const Tl = nodeLabel === undefined ? N : nodeLabel == null ? null : d3.map(mutableNodes, (d) => nodeLabel(d) ?? '');
  const Tt = nodeTitleFunc == null ? null : d3.map(mutableNodes, (d, i) => {
    const value = (d as any).value || 0;
    return nodeTitleFunc({ id: d.id, value });
  });
  const Lt = linkTitleFunc == null ? null : d3.map(mutableLinks, (d) => {
    const source = d.source as any;
    const target = d.target as any;
    const value = (d as any).value || 0;
    return linkTitleFunc({ source: { id: source.id || '' }, target: { id: target.id || '' }, value });
  });

  // A unique identifier for clip paths
  const uid = `O-${Math.random().toString(16).slice(2)}`;

  const svg = d3
    .create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", [0, 0, width, height])
    .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

  const node = svg
    .append("g")
    .attr("stroke", nodeStroke)
    .attr("stroke-width", nodeStrokeWidth)
    .attr("stroke-opacity", nodeStrokeOpacity)
    .attr("stroke-linejoin", nodeStrokeLinejoin)
    .selectAll("rect")
    .data(mutableNodes)
    .join("rect")
    .attr("x", (d: any) => d.x0)
    .attr("y", (d: any) => d.y0)
    .attr("height", (d: any) => d.y1 - d.y0)
    .attr("width", (d: any) => d.x1 - d.x0);

  if (G && color) {
    node.attr("fill", (d: any) => {
      const idx = mutableNodes.indexOf(d);
      if (idx >= 0 && G && G[idx]) {
        const colorValue = color(G[idx]);
        return colorValue || '#888';
      }
      return '#888';
    });
  }
  if (Tt) {
    node.append("title").text((d: any) => {
      const idx = mutableNodes.indexOf(d);
      return idx >= 0 && Tt[idx] ? Tt[idx] : '';
    });
  }

  const link = svg
    .append("g")
    .attr("fill", "none")
    .attr("stroke-opacity", linkStrokeOpacity)
    .selectAll("g")
    .data(mutableLinks)
    .join("g")
    .style("mix-blend-mode", linkMixBlendMode);

  // Apply link style based on linkStyle prop
  const applyLinkStyle = (pathSelection: any) => {
    switch (linkStyle) {
      case "dashed":
        pathSelection.attr("stroke-dasharray", (d: any) => {
          const width = Math.max(1, d.width || 1);
          return `${width * 3},${width * 2}`;
        });
        break;
      case "dotted":
        pathSelection.attr("stroke-dasharray", (d: any) => {
          const width = Math.max(1, d.width || 1);
          return `0,${width * 2}`;
        }).attr("stroke-linecap", "round");
        break;
      case "thick":
        pathSelection
          .attr("stroke-width", (d: any) => Math.max(2, (d.width || 1) * 1.5))
          .attr("stroke-opacity", Math.min(1.0, linkStrokeOpacity + 0.2));
        break;
      case "glow":
        pathSelection
          .attr("filter", `url(#glow-${uid})`)
          .attr("stroke-width", (d: any) => Math.max(2, (d.width || 1) * 1.2));
        // Add glow filter definition
        if (!svg.select(`#glow-${uid}`).node()) {
          const defs = svg.append("defs");
          const filter = defs.append("filter")
            .attr("id", `glow-${uid}`)
            .attr("x", "-50%")
            .attr("y", "-50%")
            .attr("width", "200%")
            .attr("height", "200%");
          filter.append("feGaussianBlur")
            .attr("stdDeviation", "3")
            .attr("result", "coloredBlur");
          const feMerge = filter.append("feMerge");
          feMerge.append("feMergeNode").attr("in", "coloredBlur");
          feMerge.append("feMergeNode").attr("in", "SourceGraphic");
        }
        break;
      case "animated":
        // Calculate path length after paths are created
        pathSelection.each(function(this: SVGPathElement, d: any) {
          const path = d3.select(this);
          const pathElement = path.node() as SVGPathElement;
          if (pathElement) {
            const length = pathElement.getTotalLength();
            path
              .attr("stroke-dasharray", `${length},${length}`)
              .attr("stroke-dashoffset", length)
              .style("animation", `dash-${uid} 2s linear infinite`);
          }
        });
        // Add animation keyframes
        if (typeof document !== 'undefined' && !document.getElementById(`sankey-style-${uid}`)) {
          const style = document.createElement("style");
          style.id = `sankey-style-${uid}`;
          style.textContent = `
            @keyframes dash-${uid} {
              to {
                stroke-dashoffset: 0;
              }
            }
          `;
          document.head.appendChild(style);
        }
        break;
      case "solid":
      case "gradient":
      default:
        // Default solid style - no additional styling needed
        break;
    }
  };

  if (finalLinkColor === "source-target" && G && color) {
    link
      .append("linearGradient")
      .attr("id", (d: any) => `${uid}-link-${d.index}`)
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", (d: any) => d.source.x1)
      .attr("x2", (d: any) => d.target.x0)
      .call((gradient: any) =>
        gradient
          .append("stop")
          .attr("offset", "0%")
          .attr("stop-color", (d: any) => {
            const sourceIdx = mutableNodes.indexOf(d.source);
            return sourceIdx >= 0 && G && G[sourceIdx] ? (color(G[sourceIdx]) || '#888') : '#888';
          })
      )
      .call((gradient: any) =>
        gradient
          .append("stop")
          .attr("offset", "100%")
          .attr("stop-color", (d: any) => {
            const targetIdx = mutableNodes.indexOf(d.target);
            return targetIdx >= 0 && G && G[targetIdx] ? (color(G[targetIdx]) || '#888') : '#888';
          })
      );
  }

  const pathSelection = link
    .append("path")
    .attr("d", linkPath)
    .attr(
      "stroke",
      finalLinkColor === "source-target" || linkStyle === "gradient"
        ? (d: any) => `url(#${uid}-link-${d.index || 0})`
        : finalLinkColor === "source" && G && color
          ? (d: any) => {
              const sourceIdx = mutableNodes.indexOf(d.source);
              return sourceIdx >= 0 && G && G[sourceIdx] ? (color(G[sourceIdx]) || '#888') : '#888';
            }
          : finalLinkColor === "target" && G && color
            ? (d: any) => {
                const targetIdx = mutableNodes.indexOf(d.target);
                return targetIdx >= 0 && G && G[targetIdx] ? (color(G[targetIdx]) || '#888') : '#888';
              }
            : finalLinkColor
    )
    .attr("stroke-width", (d: any) => Math.max(1, d.width))
    .call((path: any) => {
      if (Lt) {
        path.append("title").text((d: any) => {
          const idx = mutableLinks.indexOf(d);
          return idx >= 0 && Lt[idx] ? Lt[idx] : '';
        });
      }
    });

  // Apply the selected link style
  applyLinkStyle(pathSelection);

  if (Tl) {
    svg
      .append("g")
      .attr("font-family", "sans-serif")
      .attr("font-size", 14)
      .selectAll("text")
      .data(mutableNodes)
      .join("text")
      .attr("x", (d: any) => (d.x0 < width / 2 ? d.x1 + nodeLabelPadding : d.x0 - nodeLabelPadding))
      .attr("y", (d: any) => (d.y1 + d.y0) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", (d: any) => (d.x0 < width / 2 ? "start" : "end"))
      .text((d: any) => {
        const idx = mutableNodes.indexOf(d);
        return idx >= 0 && Tl && Tl[idx] ? Tl[idx] : '';
      });
  }

  function intern(value: any): any {
    return value !== null && typeof value === "object" ? value.valueOf() : value;
  }

  return svg.node();
};

export default function SankeyDiagram({
  transactionJson,
  width: propWidth,
  height = 600,
  graphId = "default",
  customColors,
  forceDarkMode,
  forceLightMode,
  linkStyle = "solid",
}: SankeyDiagramProps) {
  const svgRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(propWidth || 800);
  
  // Track dark mode state (only if not forced)
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (forceDarkMode) return true;
    if (forceLightMode) return false;
    if (typeof window === 'undefined') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Measure container width and update on resize
  useEffect(() => {
    if (!svgRef.current) return;

    const updateWidth = () => {
      if (svgRef.current) {
        const container = svgRef.current.parentElement;
        if (container) {
          const computedStyle = window.getComputedStyle(container);
          const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
          const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
          const availableWidth = container.clientWidth - paddingLeft - paddingRight;
          // Use prop width if provided, otherwise use container width
          const newWidth = propWidth || Math.max(400, availableWidth);
          setContainerWidth(newWidth);
        }
      }
    };

    // Initial measurement
    updateWidth();

    // Use ResizeObserver if available, otherwise fallback to window resize
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && svgRef.current.parentElement) {
      resizeObserver = new ResizeObserver(updateWidth);
      resizeObserver.observe(svgRef.current.parentElement);
    } else {
      window.addEventListener('resize', updateWidth);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener('resize', updateWidth);
      }
    };
  }, [propWidth]);

  // Listen for theme changes (only if not forced)
  useEffect(() => {
    if (forceDarkMode || forceLightMode) return; // Skip if forced
    if (typeof window === 'undefined') return;
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    // Set initial state
    setIsDarkMode(mediaQuery.matches);
    
    // Modern browsers
    if (mediaQuery.addEventListener) {
      const handleThemeChange = (e: MediaQueryListEvent) => {
        setIsDarkMode(e.matches);
      };
      mediaQuery.addEventListener('change', handleThemeChange);
      return () => mediaQuery.removeEventListener('change', handleThemeChange);
    } else {
      // Fallback for older browsers
      const handleThemeChange = () => {
        setIsDarkMode(mediaQuery.matches);
      };
      mediaQuery.addListener(handleThemeChange);
      return () => mediaQuery.removeListener(handleThemeChange);
    }
  }, [forceDarkMode, forceLightMode]);

  useEffect(() => {
    if (!svgRef.current) return;

    // Use custom colors if provided, otherwise use auto-detected colors
    const colorGroups = customColors || getColorGroups(isDarkMode);

    // Parse transaction JSON if it's a string
    const txJson: TransactionJson =
      typeof transactionJson === "string" ? JSON.parse(transactionJson) : transactionJson;

    // Build nodes and links from transaction data
    const nodes: Array<{ id: string }> = [];
    const links: Array<{ source: string; target: string; value: number }> = [];
    const nodeSet = new Set<string>();
    const assetAmounts = new Map<string, number>(); // Track asset totals

    // Process inputs: UTxO -> Address -> Assets
    if (txJson.inputs) {
      txJson.inputs.forEach((input) => {
        if (input.txIn) {
          const utxoId = `inutxo_${input.txIn.txHash}_${input.txIn.txIndex}`;
          const addrId = input.txIn.address
            ? `inaddr_${input.txIn.address}`
            : `inaddr_${input.txIn.txHash.slice(0, 20)}`;

          if (!nodeSet.has(utxoId)) {
            nodes.push({ id: utxoId });
            nodeSet.add(utxoId);
          }
          if (!nodeSet.has(addrId)) {
            nodes.push({ id: addrId });
            nodeSet.add(addrId);
          }

          // Add link from UTxO to address
          if (input.txIn.amount) {
            let totalLovelace = 0;
            input.txIn.amount.forEach((asset) => {
              if (asset.unit === "lovelace") {
                totalLovelace += Number(asset.quantity);
              }
            });
            if (totalLovelace > 0) {
              links.push({
                source: utxoId,
                target: addrId,
                value: totalLovelace / 1000000, // Convert to ADA
              });
            }
          }
        }
      });
    }

    // Aggregate assets from inputs
    if (txJson.inputs) {
      txJson.inputs.forEach((input) => {
        if (input.txIn?.amount) {
          input.txIn.amount.forEach((asset) => {
            const current = assetAmounts.get(asset.unit) || 0;
            assetAmounts.set(asset.unit, current + Number(asset.quantity));
          });
        }
      });
    }

    // Create asset nodes and connect from input addresses
    assetAmounts.forEach((totalAmount, unit) => {
      if (unit === "lovelace") {
        const adaId = "ada_ADA";
        if (!nodeSet.has(adaId)) {
          nodes.push({ id: adaId });
          nodeSet.add(adaId);
        }
        // Connect from all input addresses to ADA
        if (txJson.inputs) {
          txJson.inputs.forEach((input) => {
            if (input.txIn?.address) {
              const addrId = `inaddr_${input.txIn.address}`;
              if (nodeSet.has(addrId)) {
                const inputLovelace = input.txIn.amount?.find(
                  (a) => a.unit === "lovelace"
                )?.quantity;
                if (inputLovelace) {
                  links.push({
                    source: addrId,
                    target: adaId,
                    value: Number(inputLovelace) / 1000000,
                  });
                }
              }
            }
          });
        }
      } else {
        const unitId = `unit_${unit}`;
        if (!nodeSet.has(unitId)) {
          nodes.push({ id: unitId });
          nodeSet.add(unitId);
        }
        // Connect from input addresses to unit
        if (txJson.inputs) {
          txJson.inputs.forEach((input) => {
            if (input.txIn?.address) {
              const addrId = `inaddr_${input.txIn.address}`;
              const assetAmount = input.txIn.amount?.find(
                (a) => a.unit === unit
              )?.quantity;
              if (assetAmount && nodeSet.has(addrId)) {
                links.push({
                  source: addrId,
                  target: unitId,
                  value: Number(assetAmount),
                });
              }
            }
          });
        }
      }
    });

    // Process mints
    if (txJson.mints) {
      txJson.mints.forEach((mint) => {
        if (mint.policyId && mint.mintValue) {
          const mintId = "mint_MINT";
          if (!nodeSet.has(mintId)) {
            nodes.push({ id: mintId });
            nodeSet.add(mintId);
          }
          mint.mintValue.forEach((mv) => {
            const assetName = mv.assetName || "";
            // Cardano native assets: unit format is policyId + assetName (hex)
            // The asset.unit field in inputs/outputs already contains this format
            // So we need to match that format exactly
            // Convert assetName to hex if it's a string, otherwise use as-is
            let assetNameHex = "";
            // If it's already hex, use it; otherwise convert to hex
            if (/^[0-9a-fA-F]+$/.test(assetName)) {
              assetNameHex = assetName;
            } else {
              // Convert string to hex
              assetNameHex = Array.from(assetName)
                .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
                .join("");
            }
            // Use the standard unit format: policyId + assetNameHex (matches asset.unit format)
            const unit = `${mint.policyId}${assetNameHex}`;
            const unitId = `unit_${unit}`;
            if (!nodeSet.has(unitId)) {
              nodes.push({ id: unitId });
              nodeSet.add(unitId);
            }
            links.push({
              source: mintId,
              target: unitId,
              value: Number(mv.amount),
            });
            // Update asset amounts with the correct unit format
            const current = assetAmounts.get(unit) || 0;
            assetAmounts.set(unit, current + Number(mv.amount));
          });
        }
      });
    }

    // Process outputs: Assets -> Output UTxOs -> Output addresses
    if (txJson.outputs) {
      txJson.outputs.forEach((output, outputIndex) => {
        // Create output UTxO node
        const utxoId = `oututxo_output_${outputIndex}`;
        if (!nodeSet.has(utxoId)) {
          nodes.push({ id: utxoId });
          nodeSet.add(utxoId);
        }

        // Create output address node
        const addrId = `outaddr_${output.address}`;
        if (!nodeSet.has(addrId)) {
          nodes.push({ id: addrId });
          nodeSet.add(addrId);
        }

        // Link from assets to output UTxO
        output.amount.forEach((asset) => {
          if (asset.unit === "lovelace") {
            const adaId = "ada_ADA";
            if (nodeSet.has(adaId)) {
              links.push({
                source: adaId,
                target: utxoId,
                value: Number(asset.quantity) / 1000000, // Convert to ADA
              });
            }
          } else {
            const unitId = `unit_${asset.unit}`;
            // Ensure unit node exists (it might only be in outputs or mints)
            if (!nodeSet.has(unitId)) {
              nodes.push({ id: unitId });
              nodeSet.add(unitId);
            }
            links.push({
              source: unitId,
              target: utxoId,
              value: Number(asset.quantity),
            });
          }
        });

        // Link from output UTxO to output address
        // Create separate links for each asset type to maintain proper flow
        output.amount.forEach((asset) => {
          if (asset.unit === "lovelace") {
            links.push({
              source: utxoId,
              target: addrId,
              value: Number(asset.quantity) / 1000000, // Convert to ADA
            });
          } else {
            const unitId = `unit_${asset.unit}`;
            // Ensure the unit node exists (it should from input processing)
            if (!nodeSet.has(unitId)) {
              nodes.push({ id: unitId });
              nodeSet.add(unitId);
            }
            links.push({
              source: utxoId,
              target: addrId,
              value: Number(asset.quantity),
            });
          }
        });
      });
    }

    // Process change address (if specified and different from outputs)
    if (txJson.changeAddress) {
      const changeAddrId = `outaddr_${txJson.changeAddress}`;
      // Only create change node if it doesn't already exist as an output
      if (!nodeSet.has(changeAddrId)) {
        nodes.push({ id: changeAddrId });
        nodeSet.add(changeAddrId);
        
        // Calculate change amount (total input - total output - fee)
        let totalInput = 0;
        let totalOutput = 0;
        
        if (txJson.inputs) {
          txJson.inputs.forEach((input) => {
            if (input.txIn?.amount) {
              input.txIn.amount.forEach((asset) => {
                if (asset.unit === "lovelace") {
                  totalInput += Number(asset.quantity);
                }
              });
            }
          });
        }
        
        if (txJson.outputs) {
          txJson.outputs.forEach((output) => {
            output.amount.forEach((asset) => {
              if (asset.unit === "lovelace") {
                totalOutput += Number(asset.quantity);
              }
            });
          });
        }
        
        const feeAmount = txJson.fee ? Number(txJson.fee) : 0;
        const changeAmount = (totalInput - totalOutput - feeAmount) / 1000000;
        
        if (changeAmount > 0) {
          const adaId = "ada_ADA";
          if (nodeSet.has(adaId)) {
            links.push({
              source: adaId,
              target: changeAddrId,
              value: changeAmount,
            });
          }
        }
      }
    }

    // Process collaterals
    if (txJson.collaterals) {
      txJson.collaterals.forEach((collateral) => {
        if (collateral.txIn) {
          const utxoId = `inutxo_${collateral.txIn.txHash}_${collateral.txIn.txIndex}`;
          const collateralId = "collateral_COLLATERAL";
          if (!nodeSet.has(utxoId)) {
            nodes.push({ id: utxoId });
            nodeSet.add(utxoId);
          }
          if (!nodeSet.has(collateralId)) {
            nodes.push({ id: collateralId });
            nodeSet.add(collateralId);
          }
          if (collateral.txIn.amount) {
            collateral.txIn.amount.forEach((asset) => {
              if (asset.unit === "lovelace") {
                links.push({
                  source: utxoId,
                  target: collateralId,
                  value: Number(asset.quantity) / 1000000,
                });
              }
            });
          }
        }
      });
    }

    // Process fee
    if (txJson.fee && Number(txJson.fee) > 0) {
      const feeId = "fee_FEE";
      if (!nodeSet.has(feeId)) {
        nodes.push({ id: feeId });
        nodeSet.add(feeId);
      }
      // Link fee from ADA pool
      const adaId = "ada_ADA";
      if (nodeSet.has(adaId)) {
        links.push({
          source: adaId,
          target: feeId,
          value: Number(txJson.fee) / 1000000,
        });
      }
    }

    // Debug logging (can be removed in production)
    if (process.env.NODE_ENV === 'development') {
      console.log('Sankey Diagram - Nodes:', nodes.length, 'Links:', links.length);
      console.log('Transaction components:', {
        inputs: txJson.inputs?.length || 0,
        outputs: txJson.outputs?.length || 0,
        mints: txJson.mints?.length || 0,
        collaterals: txJson.collaterals?.length || 0,
        fee: txJson.fee,
        changeAddress: txJson.changeAddress,
      });
    }

    if (nodes.length === 0 || links.length === 0) {
      console.warn('Sankey Diagram: No nodes or links to display');
      return;
    }

    // Clear previous SVG
    d3.select(svgRef.current).select("svg").remove();

    // Create and append the Sankey chart
    const chart = SankeyChart(
      { nodes, links },
      {
        width: containerWidth,
        height,
        nodeGroups: colorGroups.map((m) => m[0]).filter((g): g is string => g !== undefined),
        colors: colorGroups.map((m) => m[1]).filter((c): c is string => c !== undefined),
        // Use lighter stroke colors in dark mode
        nodeStroke: isDarkMode ? "rgba(255, 255, 255, 0.1)" : "currentColor",
        linkStrokeOpacity: isDarkMode ? 0.9 : 0.8,
        linkStyle: linkStyle,
      }
    );
    if (chart) {
      svgRef.current.appendChild(chart);
    }
  }, [transactionJson, containerWidth, height, graphId, isDarkMode, linkStyle]);

  return (
    <div 
      ref={svgRef} 
      id={`sk${graphId}`} 
      className="w-full overflow-auto"
      style={{ minHeight: `${height}px` }}
    />
  );
}

