export const CONFIG = {
  iconSize: 80,
  textBox: {
    minWidth: 160,
    maxWidth: 360,
    horizontalPadding: 15,
    lineHeight: 20,
    verticalPadding: 15,
  },
  container: {
    minWidth: 120,
    minHeight: 120,
  },
  layout: {
    nodeSpacing: 240,
    layerSpacing: 240,
    edgeNodeSpacing: 240,
  },
  elk: {
    groupPadding: {
      top: 40,
      left: 40,
      bottom: 40,
      right: 40,
    },
    resourceNodeSpacing: 80,
    containerNodeSpacing: 160,
    containerLayerSpacing: 240,
    edgeNudgingDistance: 16,
    edgeCrossingPenalty: 100,
    rootPadding: "[top=40,left=40,bottom=40,right=40]",
  },
} as const;
