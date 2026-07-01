import * as opentypeNamespace from "opentype.js";
import type * as opentypeTypes from "opentype.js";

type OpenTypeModule = typeof opentypeTypes & {
  default?: typeof opentypeTypes;
};

const moduleWithDefault = opentypeNamespace as OpenTypeModule;

export const opentype = moduleWithDefault.Path
  ? (moduleWithDefault as typeof opentypeTypes)
  : (moduleWithDefault.default as typeof opentypeTypes);

