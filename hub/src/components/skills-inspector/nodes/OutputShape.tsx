import type { NodeProps } from 'reactflow';
import type { SkillFlowNodeData } from '../layout.js';
import { useInspector } from '../InspectorContext.js';
import { NODE_TYPE_CONFIG } from '../nodeTypeConfig.js';
import BaseNode from './BaseNode.js';

const EMPTY: readonly never[] = [];
const CONFIG = NODE_TYPE_CONFIG['output-shape'];

export default function OutputShapeNode(props: NodeProps<SkillFlowNodeData>): JSX.Element {
  const { overlay, provenanceState, risksByNode, selectedNodeId } = useInspector();
  return (
    <BaseNode
      {...props}
      accent={CONFIG.color}
      typeLabel={CONFIG.label}
      icon={CONFIG.icon}
      borderStyle={CONFIG.borderStyle}
      risks={risksByNode.get(props.id) ?? EMPTY}
      overlay={overlay}
      provenanceState={provenanceState}
      isAnySelected={selectedNodeId !== null}
    />
  );
}
