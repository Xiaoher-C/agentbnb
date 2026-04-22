import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];

export default function TriggerNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode } = useInspector();
  return (
    <BaseNode
      {...props}
      accent="#10B981"
      icon="◉"
      typeLabel="Trigger"
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
    />
  );
}
