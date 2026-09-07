export const COMPLETE_REQUIREMENT_REPLACEMENT_GUIDANCE =
  "Each indexed repair replacement is a complete requirement object, not a patch; omitted provenance fields are deleted. Use requirement_addition only for the controller-selected missing source. Use the selected keyed removal for an invalid ignored classification.";

export const SINGLE_REPAIR_ITEM_GUIDANCE =
  "Submit exactly one semantic repair item: one indexed requirement repair, one requirement_addition, or one keyed classification change. One indexed requirement may split into multiple complete replacements.";
