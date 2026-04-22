/**
 * InspectorContext — canvas-wide state consumed by individual flow-node
 * components. React Flow's NodeProps only give the node body access to its
 * own data, so cross-cutting concerns (active overlay, per-node risks,
 * skill-level provenance) flow through context instead of prop-drilling.
 */
import { createContext, useContext } from 'react';
import type { ProvenanceState, RiskIssue } from '../../lib/skillsApi.js';
import type { OverlayMode } from './nodes/BaseNode.js';

export interface InspectorContextValue {
  overlay: OverlayMode;
  provenanceState: ProvenanceState;
  risksByNode: ReadonlyMap<string, readonly RiskIssue[]>;
  onNodeSelect: (nodeId: string) => void;
}

const defaultValue: InspectorContextValue = {
  overlay: 'none',
  provenanceState: 'untracked',
  risksByNode: new Map(),
  onNodeSelect: () => {},
};

export const InspectorContext = createContext<InspectorContextValue>(defaultValue);

export function useInspector(): InspectorContextValue {
  return useContext(InspectorContext);
}
