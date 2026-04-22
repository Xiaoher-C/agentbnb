import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];

export default function OutputShapeNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode } = useInspector();
  return (
    <BaseNode
      {...props}
      accent="#34D399"
      icon="↵"
      typeLabel="Output"
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
    />
  );
}
