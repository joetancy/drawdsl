export const CONFIG = {
  iconSize: 80,
  textBox: {
    minWidth: 160,
    maxWidth: 360,
    horizontalPadding: 32,
    lineHeight: 20,
    verticalPadding: 20,
  },
  container: {
    minWidth: 120,
    minHeight: 120,
  },
  layout: {
    nodeSpacing: 80,
    layerSpacing: 120,
    edgeNodeSpacing: 40,
  },
  elk: {
    groupPadding: {
      top: 40,
      left: 40,
      bottom: 40,
      right: 40,
    },
    containerNodeSpacing: 80,
    containerLayerSpacing: 80,
    rootPadding: "[top=40,left=40,bottom=40,right=40]",
  },
} as const;
