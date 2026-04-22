import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];

export default function InstructionNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode } = useInspector();
  return (
    <BaseNode
      {...props}
      accent="#60A5FA"
      icon="▤"
      typeLabel="Instruction"
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
    />
  );
}
