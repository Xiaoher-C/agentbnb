import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];

export default function ExampleNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode } = useInspector();
  return (
    <BaseNode
      {...props}
      accent="#94A3B8"
      icon="▢"
      typeLabel="Example"
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
    />
  );
}
