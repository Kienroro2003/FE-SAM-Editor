import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, ElkPort, LayoutOptions } from 'elkjs/lib/elk-api';
import ReactFlow, {
  BaseEdge,
  Background,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { AnalysisGraphNodeResponse, FunctionCfgResponse } from '../../shared/api/types';
import { LoadingState } from '../common/LoadingState';

interface CfgGraphProps {
  cfg: FunctionCfgResponse | null;
  isLoading: boolean;
  onNodeSelect: (startLine: number, endLine: number | null) => void;
}

interface CfgHandleData {
  id: string;
  type: 'source' | 'target';
  position: Position;
  style: CSSProperties;
}

interface CfgNodeData {
  nodeType: string;
  label: string;
  lineRange: string | null;
  startLine: number | null;
  endLine: number | null;
  handles: CfgHandleData[];
}

interface EdgePoint {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface CfgEdgeData {
  points: EdgePoint[];
  label: string | null;
}

type CfgEdgeResponse = FunctionCfgResponse['edges'][number];
type PortSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

interface NodeOrderingConstraint {
  inLayerPredOf?: string;
  inLayerSuccOf?: string;
}

type RoutingDirection = 'up' | 'down' | 'left' | 'right';

interface LayoutNodeInfo {
  node: ElkNode;
  bounds: Rect;
  portsByHandleId: Map<string, ElkPort>;
}

const NODE_WIDTH = 224;
const NODE_HEIGHT = 112;
const PORT_SIZE = 12;
const ROUTING_NODE_MARGIN = 20;
const ROUTING_LANE_GAP = 36;
const ROUTING_BOUNDARY_PADDING = 112;
const ROUTING_PORT_EXIT_DISTANCE = 30;
const ROUTING_TURN_PENALTY = 32;
const ROUTING_SEGMENT_REUSE_PENALTY = 180;
const ROUTING_BRANCH_SIDE_PENALTY = 72;
const ROUTING_BRANCH_PREFERENCE_DEPTH = 136;
const elk = new ELK();

function isDecisionNode(type: string): boolean {
  return type === 'CONDITION' || type === 'LOOP_CONDITION';
}

function formatLineRange(startLine: number | null, endLine: number | null): string | null {
  if (startLine == null || endLine == null) {
    return null;
  }
  return startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}-${endLine}`;
}

function edgeTone(label: string | null): string {
  switch (label) {
    case 'true':
      return '#197d4f';
    case 'false':
      return '#b94040';
    case 'loop':
      return '#0f766e';
    case 'break':
      return '#b67b1f';
    case 'return':
      return '#725f4b';
    default:
      return '#8b7864';
  }
}

function nodeStyle(type: string): Node['style'] {
  switch (type) {
    case 'ENTRY':
      return {
        background: '#def6ea',
        borderColor: '#197d4f',
        color: '#125b39',
      };
    case 'EXIT':
      return {
        background: '#fce4e4',
        borderColor: '#b94040',
        color: '#7f2b2b',
      };
    case 'CONDITION':
    case 'LOOP_CONDITION':
      return {
        background: '#fff0d7',
        borderColor: '#b67b1f',
        color: '#805717',
      };
    case 'RETURN':
    case 'BREAK':
      return {
        background: '#ede7ff',
        borderColor: '#6c57b8',
        color: '#47378a',
      };
    case 'JOIN':
      return {
        background: '#e6f3ff',
        borderColor: '#1a77b8',
        color: '#115178',
      };
    default:
      return {
        background: '#fffdf8',
        borderColor: '#dfd2bf',
        color: '#2f2419',
      };
  }
}

function sortNodes(left: AnalysisGraphNodeResponse, right: AnalysisGraphNodeResponse): number {
  const leftLine = left.startLine ?? Number.MAX_SAFE_INTEGER;
  const rightLine = right.startLine ?? Number.MAX_SAFE_INTEGER;
  if (leftLine !== rightLine) {
    return leftLine - rightLine;
  }
  return left.id.localeCompare(right.id);
}

function buildPath(points: EdgePoint[]): string {
  const [start, ...rest] = points;
  if (!start) {
    return '';
  }
  return rest.reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${start.x} ${start.y}`);
}

function resolveNodeLine(node: AnalysisGraphNodeResponse | undefined): number {
  return node?.startLine ?? Number.MAX_SAFE_INTEGER;
}

function compareEdgesByOppositeNode(
  left: CfgEdgeResponse,
  right: CfgEdgeResponse,
  nodeById: Map<string, AnalysisGraphNodeResponse>,
  direction: 'incoming' | 'outgoing',
): number {
  const leftNode = direction === 'incoming' ? nodeById.get(left.source) : nodeById.get(left.target);
  const rightNode = direction === 'incoming' ? nodeById.get(right.source) : nodeById.get(right.target);
  const lineDifference = resolveNodeLine(leftNode) - resolveNodeLine(rightNode);
  if (lineDifference !== 0) {
    return lineDifference;
  }
  return left.id.localeCompare(right.id);
}

function compareTopIncomingEdges(
  left: CfgEdgeResponse,
  right: CfgEdgeResponse,
  nodeById: Map<string, AnalysisGraphNodeResponse>,
): number {
  const branchPriority = (edge: CfgEdgeResponse): number => {
    switch (edge.label) {
      case 'false':
        return 0;
      case 'true':
        return 2;
      default:
        return 1;
    }
  };

  const priorityDifference = branchPriority(left) - branchPriority(right);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return compareEdgesByOppositeNode(left, right, nodeById, 'incoming');
}

function findLabelPosition(points: EdgePoint[]): EdgePoint {
  if (points.length < 2) {
    return points[0] ?? { x: 0, y: 0 };
  }

  let longestSegmentLength = -1;
  let labelPoint = points[0];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const segmentLength = Math.abs(next.x - current.x) + Math.abs(next.y - current.y);
    if (segmentLength <= longestSegmentLength) {
      continue;
    }
    longestSegmentLength = segmentLength;
    labelPoint = {
      x: (current.x + next.x) / 2,
      y: (current.y + next.y) / 2,
    };
  }
  return labelPoint;
}

function buildPort(nodeId: string, portId: string, side: PortSide, index: number): ElkPort {
  return {
    id: `${nodeId}:${portId}`,
    width: PORT_SIZE,
    height: PORT_SIZE,
    layoutOptions: {
      'org.eclipse.elk.port.side': side,
      'org.eclipse.elk.port.index': `${index}`,
    },
  };
}

function resolveSourceHandleId(node: AnalysisGraphNodeResponse, edgeId: string, label: string | null): string {
  if (isDecisionNode(node.type)) {
    if (label === 'false') {
      return `source-left-${edgeId}`;
    }
    if (label === 'true') {
      return `source-right-${edgeId}`;
    }
  }
  return `source-bottom-${edgeId}`;
}

function resolveTargetHandleId(edgeId: string, label: string | null): string {
  if (label === 'break') {
    return `target-left-${edgeId}`;
  }
  if (label === 'loop') {
    return `target-right-${edgeId}`;
  }
  return `target-top-${edgeId}`;
}

function resolveSourcePortId(node: AnalysisGraphNodeResponse, edgeId: string, label: string | null): string {
  return `${node.id}:${resolveSourceHandleId(node, edgeId, label)}`;
}

function resolveTargetPortId(nodeId: string, edgeId: string, label: string | null): string {
  return `${nodeId}:${resolveTargetHandleId(edgeId, label)}`;
}

function buildNodeOrderingConstraints(
  nodes: AnalysisGraphNodeResponse[],
  outgoingEdgesBySource: Map<string, FunctionCfgResponse['edges']>,
): Map<string, NodeOrderingConstraint> {
  const constraints = new Map<string, NodeOrderingConstraint>();

  nodes.forEach((node) => {
    if (!isDecisionNode(node.type)) {
      return;
    }

    const outgoingEdges = outgoingEdgesBySource.get(node.id) ?? [];
    const falseEdge = outgoingEdges.find((edge) => edge.label === 'false');
    const trueEdge = outgoingEdges.find((edge) => edge.label === 'true');

    if (!falseEdge || !trueEdge || falseEdge.target === trueEdge.target) {
      return;
    }

    const falseTargetConstraint = constraints.get(falseEdge.target) ?? {};
    if (!falseTargetConstraint.inLayerPredOf || falseTargetConstraint.inLayerPredOf === trueEdge.target) {
      falseTargetConstraint.inLayerPredOf = trueEdge.target;
      constraints.set(falseEdge.target, falseTargetConstraint);
    }

    const trueTargetConstraint = constraints.get(trueEdge.target) ?? {};
    if (!trueTargetConstraint.inLayerSuccOf || trueTargetConstraint.inLayerSuccOf === falseEdge.target) {
      trueTargetConstraint.inLayerSuccOf = falseEdge.target;
      constraints.set(trueEdge.target, trueTargetConstraint);
    }
  });

  return constraints;
}

function buildPorts(
  node: AnalysisGraphNodeResponse,
  nodeById: Map<string, AnalysisGraphNodeResponse>,
  incomingEdges: FunctionCfgResponse['edges'],
  outgoingEdges: FunctionCfgResponse['edges'],
): ElkPort[] {
  const northPorts = [...incomingEdges]
    .filter((edge) => edge.label !== 'break' && edge.label !== 'loop')
    .sort((left, right) => compareTopIncomingEdges(left, right, nodeById))
    .map((edge) => ({
      handleId: resolveTargetHandleId(edge.id, edge.label),
      side: 'NORTH' as const,
    }));

  const eastPorts = [
    ...[...incomingEdges]
      .filter((edge) => edge.label === 'loop')
      .sort((left, right) => compareEdgesByOppositeNode(left, right, nodeById, 'incoming'))
      .map((edge) => ({
        handleId: resolveTargetHandleId(edge.id, edge.label),
        side: 'EAST' as const,
      })),
    ...[...outgoingEdges]
      .filter((edge) => resolveSourceHandleId(node, edge.id, edge.label).startsWith('source-right'))
      .sort((left, right) => compareEdgesByOppositeNode(left, right, nodeById, 'outgoing'))
      .map((edge) => ({
        handleId: resolveSourceHandleId(node, edge.id, edge.label),
        side: 'EAST' as const,
      })),
  ];

  const southPorts = [...outgoingEdges]
    .filter((edge) => resolveSourceHandleId(node, edge.id, edge.label).startsWith('source-bottom'))
    .sort((left, right) => compareEdgesByOppositeNode(left, right, nodeById, 'outgoing'))
    .map((edge) => ({
      handleId: resolveSourceHandleId(node, edge.id, edge.label),
      side: 'SOUTH' as const,
    }));

  const westPorts = [
    ...[...outgoingEdges]
      .filter((edge) => resolveSourceHandleId(node, edge.id, edge.label).startsWith('source-left'))
      .sort((left, right) => compareEdgesByOppositeNode(left, right, nodeById, 'outgoing'))
      .map((edge) => ({
        handleId: resolveSourceHandleId(node, edge.id, edge.label),
        side: 'WEST' as const,
      })),
    ...[...incomingEdges]
      .filter((edge) => edge.label === 'break')
      .sort((left, right) => compareEdgesByOppositeNode(left, right, nodeById, 'incoming'))
      .map((edge) => ({
        handleId: resolveTargetHandleId(edge.id, edge.label),
        side: 'WEST' as const,
      })),
  ];

  const orderedPorts = [...northPorts, ...eastPorts, ...southPorts, ...westPorts];
  return orderedPorts.map((port, index) => buildPort(node.id, port.handleId, port.side, index));
}

function detectPortSide(shapeId?: string): 'top' | 'bottom' | 'left' | 'right' | null {
  if (!shapeId) {
    return null;
  }

  if (shapeId.includes(':target-top-')) {
    return 'top';
  }
  if (shapeId.includes(':source-bottom-')) {
    return 'bottom';
  }
  if (shapeId.includes(':target-left-') || shapeId.includes(':source-left-')) {
    return 'left';
  }
  if (shapeId.includes(':target-right-') || shapeId.includes(':source-right-')) {
    return 'right';
  }

  return null;
}

function snapPointToNodeBoundary(point: EdgePoint, shapeId?: string): EdgePoint {
  switch (detectPortSide(shapeId)) {
    case 'top':
      return { x: point.x, y: point.y + PORT_SIZE };
    case 'bottom':
      return { x: point.x, y: point.y - PORT_SIZE };
    case 'left':
      return { x: point.x + PORT_SIZE, y: point.y };
    case 'right':
      return { x: point.x - PORT_SIZE, y: point.y };
    default:
      return point;
  }
}

function extractSectionPoints(edge: ElkExtendedEdge): EdgePoint[] {
  const sections = edge.sections ?? [];
  if (sections.length === 0) {
    return [];
  }

  const allPoints: EdgePoint[] = [];

  sections.forEach((section, index) => {
    const points = [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint,
    ].map((point) => ({ x: point.x, y: point.y }));

    if (points.length === 0) {
      return;
    }

    if (index === 0) {
      points[0] = snapPointToNodeBoundary(points[0], section.incomingShape ?? edge.sources?.[0]);
    }

    if (index === sections.length - 1) {
      points[points.length - 1] = snapPointToNodeBoundary(
        points[points.length - 1],
        section.outgoingShape ?? edge.targets?.[0],
      );
    }

    if (allPoints.length > 0) {
      const lastPoint = allPoints[allPoints.length - 1];
      const firstPoint = points[0];
      if (lastPoint.x === firstPoint.x && lastPoint.y === firstPoint.y) {
        allPoints.push(...points.slice(1));
        return;
      }
    }

    allPoints.push(...points);
  });

  return allPoints;
}

function roundCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

function buildNodeBounds(node: ElkNode): Rect {
  const left = node.x ?? 0;
  const top = node.y ?? 0;
  const width = node.width ?? NODE_WIDTH;
  const height = node.height ?? NODE_HEIGHT;

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
  };
}

function expandRect(rect: Rect, margin: number): Rect {
  return {
    left: rect.left - margin,
    top: rect.top - margin,
    right: rect.right + margin,
    bottom: rect.bottom + margin,
  };
}

function pointInsideRect(point: EdgePoint, rect: Rect): boolean {
  return point.x > rect.left && point.x < rect.right && point.y > rect.top && point.y < rect.bottom;
}

function segmentIntersectsRect(start: EdgePoint, end: EdgePoint, rect: Rect): boolean {
  if (start.x === end.x) {
    const x = start.x;
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    return x > rect.left && x < rect.right && bottom > rect.top && top < rect.bottom;
  }

  if (start.y === end.y) {
    const y = start.y;
    const left = Math.min(start.x, end.x);
    const right = Math.max(start.x, end.x);
    return y > rect.top && y < rect.bottom && right > rect.left && left < rect.right;
  }

  return true;
}

function isOrthogonalSegmentClear(start: EdgePoint, end: EdgePoint, obstacles: Rect[]): boolean {
  if (start.x !== end.x && start.y !== end.y) {
    return false;
  }

  return obstacles.every((rect) => !segmentIntersectsRect(start, end, rect));
}

function routingDirectionFromHandleId(handleId: string): RoutingDirection {
  switch (handlePositionFromId(handleId)) {
    case Position.Top:
      return 'up';
    case Position.Left:
      return 'left';
    case Position.Right:
      return 'right';
    default:
      return 'down';
  }
}

function movePoint(point: EdgePoint, direction: RoutingDirection, distance: number): EdgePoint {
  switch (direction) {
    case 'up':
      return { x: point.x, y: point.y - distance };
    case 'down':
      return { x: point.x, y: point.y + distance };
    case 'left':
      return { x: point.x - distance, y: point.y };
    case 'right':
      return { x: point.x + distance, y: point.y };
  }
}

function fallbackAnchorPoint(bounds: Rect, handleId: string): EdgePoint {
  switch (routingDirectionFromHandleId(handleId)) {
    case 'up':
      return {
        x: roundCoordinate((bounds.left + bounds.right) / 2),
        y: roundCoordinate(bounds.top),
      };
    case 'down':
      return {
        x: roundCoordinate((bounds.left + bounds.right) / 2),
        y: roundCoordinate(bounds.bottom),
      };
    case 'left':
      return {
        x: roundCoordinate(bounds.left),
        y: roundCoordinate((bounds.top + bounds.bottom) / 2),
      };
    case 'right':
      return {
        x: roundCoordinate(bounds.right),
        y: roundCoordinate((bounds.top + bounds.bottom) / 2),
      };
  }
}

function resolveAnchorPoint(nodeInfo: LayoutNodeInfo, handleId: string): EdgePoint {
  const port = nodeInfo.portsByHandleId.get(handleId);
  if (!port) {
    return fallbackAnchorPoint(nodeInfo.bounds, handleId);
  }

  const centerX = (nodeInfo.node.x ?? 0) + (port.x ?? 0) + PORT_SIZE / 2;
  const centerY = (nodeInfo.node.y ?? 0) + (port.y ?? 0) + PORT_SIZE / 2;

  switch (routingDirectionFromHandleId(handleId)) {
    case 'up':
      return {
        x: roundCoordinate(centerX),
        y: roundCoordinate(nodeInfo.bounds.top),
      };
    case 'down':
      return {
        x: roundCoordinate(centerX),
        y: roundCoordinate(nodeInfo.bounds.bottom),
      };
    case 'left':
      return {
        x: roundCoordinate(nodeInfo.bounds.left),
        y: roundCoordinate(centerY),
      };
    case 'right':
      return {
        x: roundCoordinate(nodeInfo.bounds.right),
        y: roundCoordinate(centerY),
      };
  }
}

function segmentKey(start: EdgePoint, end: EdgePoint): string {
  if (start.x === end.x) {
    const top = Math.min(start.y, end.y);
    const bottom = Math.max(start.y, end.y);
    return `v:${roundCoordinate(start.x)}:${roundCoordinate(top)}:${roundCoordinate(bottom)}`;
  }

  const left = Math.min(start.x, end.x);
  const right = Math.max(start.x, end.x);
  return `h:${roundCoordinate(start.y)}:${roundCoordinate(left)}:${roundCoordinate(right)}`;
}

function orthogonalDirection(start: EdgePoint, end: EdgePoint): RoutingDirection | null {
  if (start.x === end.x) {
    return end.y >= start.y ? 'down' : 'up';
  }
  if (start.y === end.y) {
    return end.x >= start.x ? 'right' : 'left';
  }
  return null;
}

function branchSidePenalty(
  edge: CfgEdgeResponse,
  start: EdgePoint,
  end: EdgePoint,
  sourceBounds: Rect,
): number {
  if (edge.label !== 'false' && edge.label !== 'true') {
    return 0;
  }

  const branchPreferenceLimit = sourceBounds.bottom + ROUTING_BRANCH_PREFERENCE_DEPTH;
  if (Math.min(start.y, end.y) > branchPreferenceLimit) {
    return 0;
  }

  const sourceCenterX = (sourceBounds.left + sourceBounds.right) / 2;
  const wrongSide =
    edge.label === 'false'
      ? Math.max(start.x, end.x) > sourceCenterX
      : Math.min(start.x, end.x) < sourceCenterX;

  return wrongSide ? ROUTING_BRANCH_SIDE_PENALTY : 0;
}

function buildRoutingCoordinateAxis(
  obstacles: Rect[],
  endpoints: EdgePoint[],
  axis: 'x' | 'y',
): number[] {
  const values = new Set<number>();

  obstacles.forEach((rect) => {
    const start = axis === 'x' ? rect.left : rect.top;
    const end = axis === 'x' ? rect.right : rect.bottom;
    [start, end, start - ROUTING_LANE_GAP, end + ROUTING_LANE_GAP].forEach((value) => values.add(roundCoordinate(value)));
  });

  endpoints.forEach((point) => values.add(roundCoordinate(axis === 'x' ? point.x : point.y)));

  const obstacleStarts = obstacles.map((rect) => (axis === 'x' ? rect.left : rect.top));
  const obstacleEnds = obstacles.map((rect) => (axis === 'x' ? rect.right : rect.bottom));
  const min = Math.min(...obstacleStarts, ...endpoints.map((point) => (axis === 'x' ? point.x : point.y)));
  const max = Math.max(...obstacleEnds, ...endpoints.map((point) => (axis === 'x' ? point.x : point.y)));
  values.add(roundCoordinate(min - ROUTING_BOUNDARY_PADDING));
  values.add(roundCoordinate(max + ROUTING_BOUNDARY_PADDING));

  return [...values].sort((left, right) => left - right);
}

class RoutingQueue<T> {
  private items: T[] = [];

  constructor(private readonly score: (item: T) => number) {}

  push(item: T): void {
    this.items.push(item);
    this.bubbleUp(this.items.length - 1);
  }

  pop(): T | undefined {
    const first = this.items[0];
    const last = this.items.pop();
    if (!first || !last) {
      return first;
    }

    this.items[0] = last;
    this.bubbleDown(0);
    return first;
  }

  get size(): number {
    return this.items.length;
  }

  private bubbleUp(index: number): void {
    let currentIndex = index;

    while (currentIndex > 0) {
      const parentIndex = Math.floor((currentIndex - 1) / 2);
      if (this.score(this.items[parentIndex]) <= this.score(this.items[currentIndex])) {
        break;
      }

      [this.items[parentIndex], this.items[currentIndex]] = [this.items[currentIndex], this.items[parentIndex]];
      currentIndex = parentIndex;
    }
  }

  private bubbleDown(index: number): void {
    let currentIndex = index;

    while (true) {
      const leftIndex = currentIndex * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = currentIndex;

      if (leftIndex < this.items.length && this.score(this.items[leftIndex]) < this.score(this.items[smallestIndex])) {
        smallestIndex = leftIndex;
      }

      if (rightIndex < this.items.length && this.score(this.items[rightIndex]) < this.score(this.items[smallestIndex])) {
        smallestIndex = rightIndex;
      }

      if (smallestIndex === currentIndex) {
        return;
      }

      [this.items[currentIndex], this.items[smallestIndex]] = [this.items[smallestIndex], this.items[currentIndex]];
      currentIndex = smallestIndex;
    }
  }
}

function compressOrthogonalPoints(points: EdgePoint[]): EdgePoint[] {
  const deduplicated = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });

  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) {
      return true;
    }

    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    const sameVertical = previous.x === point.x && point.x === next.x;
    const sameHorizontal = previous.y === point.y && point.y === next.y;
    return !sameVertical && !sameHorizontal;
  });
}

function routeOrthogonalEdge(
  edge: CfgEdgeResponse,
  sourceAnchor: EdgePoint,
  sourceExit: EdgePoint,
  sourceDirection: RoutingDirection,
  targetAnchor: EdgePoint,
  targetExit: EdgePoint,
  targetDirection: RoutingDirection,
  sourceBounds: Rect,
  obstacles: Rect[],
  segmentUsage: Map<string, number>,
): EdgePoint[] | null {
  const xs = buildRoutingCoordinateAxis(obstacles, [sourceExit, targetExit], 'x');
  const ys = buildRoutingCoordinateAxis(obstacles, [sourceExit, targetExit], 'y');
  const validity = ys.map((y) => xs.map((x) => !obstacles.some((rect) => pointInsideRect({ x, y }, rect))));
  const startX = xs.indexOf(roundCoordinate(sourceExit.x));
  const startY = ys.indexOf(roundCoordinate(sourceExit.y));
  const targetX = xs.indexOf(roundCoordinate(targetExit.x));
  const targetY = ys.indexOf(roundCoordinate(targetExit.y));

  if (startX === -1 || startY === -1 || targetX === -1 || targetY === -1 || !validity[startY]?.[startX] || !validity[targetY]?.[targetX]) {
    return null;
  }

  const queue = new RoutingQueue<{
    xIndex: number;
    yIndex: number;
    direction: RoutingDirection | null;
    cost: number;
    priority: number;
    stateId: string;
  }>((item) => item.priority);
  const bestCosts = new Map<string, number>();
  const previousStates = new Map<string, string | null>();
  const statePoints = new Map<string, EdgePoint>();

  const startStateId = `${startX}:${startY}:start`;
  const startPoint = { x: xs[startX], y: ys[startY] };
  bestCosts.set(startStateId, 0);
  previousStates.set(startStateId, null);
  statePoints.set(startStateId, startPoint);
  queue.push({
    xIndex: startX,
    yIndex: startY,
    direction: sourceDirection,
    cost: 0,
    priority: Math.abs(startPoint.x - targetExit.x) + Math.abs(startPoint.y - targetExit.y),
    stateId: startStateId,
  });

  let endStateId: string | null = null;

  while (queue.size > 0) {
    const current = queue.pop();
    if (!current) {
      break;
    }

    const knownCost = bestCosts.get(current.stateId);
    if (knownCost == null || current.cost > knownCost) {
      continue;
    }

    if (current.xIndex === targetX && current.yIndex === targetY) {
      endStateId = current.stateId;
      break;
    }

    const currentPoint = { x: xs[current.xIndex], y: ys[current.yIndex] };
    const neighbors = [
      { xIndex: current.xIndex - 1, yIndex: current.yIndex },
      { xIndex: current.xIndex + 1, yIndex: current.yIndex },
      { xIndex: current.xIndex, yIndex: current.yIndex - 1 },
      { xIndex: current.xIndex, yIndex: current.yIndex + 1 },
    ];

    neighbors.forEach((neighbor) => {
      if (
        neighbor.xIndex < 0 ||
        neighbor.yIndex < 0 ||
        neighbor.xIndex >= xs.length ||
        neighbor.yIndex >= ys.length ||
        !validity[neighbor.yIndex]?.[neighbor.xIndex]
      ) {
        return;
      }

      const nextPoint = { x: xs[neighbor.xIndex], y: ys[neighbor.yIndex] };
      if (!isOrthogonalSegmentClear(currentPoint, nextPoint, obstacles)) {
        return;
      }

      const nextDirection = orthogonalDirection(currentPoint, nextPoint);
      if (!nextDirection) {
        return;
      }

      const stepCost = Math.abs(nextPoint.x - currentPoint.x) + Math.abs(nextPoint.y - currentPoint.y);
      const turnPenalty = current.direction && current.direction !== nextDirection ? ROUTING_TURN_PENALTY : 0;
      const overlapPenalty = (segmentUsage.get(segmentKey(currentPoint, nextPoint)) ?? 0) * ROUTING_SEGMENT_REUSE_PENALTY;
      const sidePenalty = branchSidePenalty(edge, currentPoint, nextPoint, sourceBounds);
      const nextCost = current.cost + stepCost + turnPenalty + overlapPenalty + sidePenalty;
      const nextStateId = `${neighbor.xIndex}:${neighbor.yIndex}:${nextDirection}`;

      if (nextCost >= (bestCosts.get(nextStateId) ?? Number.POSITIVE_INFINITY)) {
        return;
      }

      bestCosts.set(nextStateId, nextCost);
      previousStates.set(nextStateId, current.stateId);
      statePoints.set(nextStateId, nextPoint);
      queue.push({
        xIndex: neighbor.xIndex,
        yIndex: neighbor.yIndex,
        direction: nextDirection,
        cost: nextCost,
        priority: nextCost + Math.abs(nextPoint.x - targetExit.x) + Math.abs(nextPoint.y - targetExit.y),
        stateId: nextStateId,
      });
    });
  }

  if (!endStateId) {
    return null;
  }

  const routedPoints: EdgePoint[] = [];
  let currentStateId: string | null = endStateId;
  while (currentStateId) {
    const point = statePoints.get(currentStateId);
    if (point) {
      routedPoints.push(point);
    }
    currentStateId = previousStates.get(currentStateId) ?? null;
  }

  const orderedRoutedPoints = compressOrthogonalPoints(routedPoints.reverse());
  return compressOrthogonalPoints([sourceAnchor, sourceExit, ...orderedRoutedPoints, targetExit, targetAnchor]);
}

function registerSegmentUsage(points: EdgePoint[], segmentUsage: Map<string, number>): void {
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    if (current.x !== next.x && current.y !== next.y) {
      continue;
    }

    const key = segmentKey(current, next);
    segmentUsage.set(key, (segmentUsage.get(key) ?? 0) + 1);
  }
}

function edgeRoutingPriority(edge: CfgEdgeResponse): number {
  switch (edge.label) {
    case 'false':
      return 0;
    case 'true':
      return 1;
    case 'loop':
      return 2;
    case 'break':
      return 3;
    case 'return':
      return 4;
    default:
      return 5;
  }
}

function buildRoutedEdgePoints(
  cfg: FunctionCfgResponse,
  layoutNodeInfos: Map<string, LayoutNodeInfo>,
  fallbackPointsByEdgeId: Map<string, EdgePoint[]>,
): Map<string, EdgePoint[]> {
  const nodeById = new Map(cfg.nodes.map((node) => [node.id, node]));
  const segmentUsage = new Map<string, number>();
  const obstacles = [...layoutNodeInfos.values()].map((info) => expandRect(info.bounds, ROUTING_NODE_MARGIN));
  const routedPointsByEdgeId = new Map<string, EdgePoint[]>();

  const orderedEdges = [...cfg.edges].sort((left, right) => {
    const priorityDifference = edgeRoutingPriority(left) - edgeRoutingPriority(right);
    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    const sourceDifference = compareEdgesByOppositeNode(left, right, nodeById, 'outgoing');
    if (sourceDifference !== 0) {
      return sourceDifference;
    }

    return left.id.localeCompare(right.id);
  });

  orderedEdges.forEach((edge) => {
    const sourceNode = nodeById.get(edge.source);
    const sourceLayout = layoutNodeInfos.get(edge.source);
    const targetLayout = layoutNodeInfos.get(edge.target);

    if (!sourceNode || !sourceLayout || !targetLayout) {
      const fallback = fallbackPointsByEdgeId.get(edge.id);
      if (fallback) {
        routedPointsByEdgeId.set(edge.id, fallback);
        registerSegmentUsage(fallback, segmentUsage);
      }
      return;
    }

    const sourceHandleId = resolveSourceHandleId(sourceNode, edge.id, edge.label);
    const targetHandleId = resolveTargetHandleId(edge.id, edge.label);
    const sourceAnchor = resolveAnchorPoint(sourceLayout, sourceHandleId);
    const targetAnchor = resolveAnchorPoint(targetLayout, targetHandleId);
    const sourceDirection = routingDirectionFromHandleId(sourceHandleId);
    const targetDirection = routingDirectionFromHandleId(targetHandleId);
    const sourceExit = movePoint(sourceAnchor, sourceDirection, ROUTING_PORT_EXIT_DISTANCE);
    const targetExit = movePoint(targetAnchor, targetDirection, ROUTING_PORT_EXIT_DISTANCE);

    const routedPoints =
      routeOrthogonalEdge(
        edge,
        sourceAnchor,
        sourceExit,
        sourceDirection,
        targetAnchor,
        targetExit,
        targetDirection,
        sourceLayout.bounds,
        obstacles,
        segmentUsage,
      ) ?? fallbackPointsByEdgeId.get(edge.id);

    if (!routedPoints || routedPoints.length < 2) {
      return;
    }

    const finalPoints = compressOrthogonalPoints(routedPoints);
    routedPointsByEdgeId.set(edge.id, finalPoints);
    registerSegmentUsage(finalPoints, segmentUsage);
  });

  return routedPointsByEdgeId;
}

function buildElkGraph(cfg: FunctionCfgResponse): ElkNode {
  const sortedNodes = [...cfg.nodes].sort(sortNodes);
  const nodeById = new Map(sortedNodes.map((node) => [node.id, node]));
  const incomingEdgesByTarget = new Map<string, FunctionCfgResponse['edges']>();
  const outgoingEdgesBySource = new Map<string, FunctionCfgResponse['edges']>();

  cfg.edges.forEach((edge) => {
    incomingEdgesByTarget.set(edge.target, [...(incomingEdgesByTarget.get(edge.target) ?? []), edge]);
    outgoingEdgesBySource.set(edge.source, [...(outgoingEdgesBySource.get(edge.source) ?? []), edge]);
  });

  const nodeOrderingConstraints = buildNodeOrderingConstraints(sortedNodes, outgoingEdgesBySource);

  const graphOptions: LayoutOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'DOWN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.padding': '[top=28,left=28,bottom=28,right=28]',
    'org.eclipse.elk.spacing.nodeNode': '120',
    'org.eclipse.elk.spacing.edgeEdge': '56',
    'org.eclipse.elk.spacing.edgeNode': '88',
    'org.eclipse.elk.layered.spacing.nodeNodeBetweenLayers': '148',
    'org.eclipse.elk.layered.spacing.edgeNodeBetweenLayers': '104',
    'org.eclipse.elk.layered.spacing.edgeEdgeBetweenLayers': '52',
    'org.eclipse.elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'org.eclipse.elk.layered.crossingMinimization.greedySwitch.type': 'TWO_SIDED',
    'org.eclipse.elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'org.eclipse.elk.layered.nodePlacement.favorStraightEdges': 'true',
    'org.eclipse.elk.layered.unnecessaryBendpoints': 'false',
    'org.eclipse.elk.layered.mergeEdges': 'false',
    'org.eclipse.elk.layered.portSortingStrategy': 'INPUT_ORDER',
    'org.eclipse.elk.layered.thoroughness': '40',
  };

  return {
    id: 'root',
    layoutOptions: graphOptions,
    children: sortedNodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layoutOptions: {
        'org.eclipse.elk.portConstraints': 'FIXED_ORDER',
        'org.eclipse.elk.portAlignment.north': 'JUSTIFIED',
        'org.eclipse.elk.portAlignment.south': 'JUSTIFIED',
        'org.eclipse.elk.portAlignment.west': 'CENTER',
        'org.eclipse.elk.portAlignment.east': 'CENTER',
        ...(nodeOrderingConstraints.get(node.id)?.inLayerPredOf
          ? {
              'org.eclipse.elk.layered.crossingMinimization.inLayerPredOf':
                nodeOrderingConstraints.get(node.id)?.inLayerPredOf ?? '',
            }
          : {}),
        ...(nodeOrderingConstraints.get(node.id)?.inLayerSuccOf
          ? {
              'org.eclipse.elk.layered.crossingMinimization.inLayerSuccOf':
                nodeOrderingConstraints.get(node.id)?.inLayerSuccOf ?? '',
            }
          : {}),
      },
      ports: buildPorts(
        node,
        nodeById,
        incomingEdgesByTarget.get(node.id) ?? [],
        outgoingEdgesBySource.get(node.id) ?? [],
      ),
    })),
    edges: cfg.edges.map((edge) => {
      const sourceNode = nodeById.get(edge.source);
      if (!sourceNode) {
        throw new Error(`Missing source node for edge ${edge.id}`);
      }

      return {
        id: edge.id,
        sources: [resolveSourcePortId(sourceNode, edge.id, edge.label)],
        targets: [resolveTargetPortId(edge.target, edge.id, edge.label)],
      };
    }),
  };
}

function handlePositionFromId(handleId: string): Position {
  if (handleId.startsWith('target-top')) {
    return Position.Top;
  }
  if (handleId.startsWith('target-left') || handleId.startsWith('source-left')) {
    return Position.Left;
  }
  if (handleId.startsWith('target-right') || handleId.startsWith('source-right')) {
    return Position.Right;
  }
  return Position.Bottom;
}

function handleTypeFromId(handleId: string): 'source' | 'target' {
  return handleId.startsWith('source-') ? 'source' : 'target';
}

function buildHandleStyle(port: ElkPort, handleId: string): CSSProperties {
  const centerXPercent = `${(((port.x ?? 0) + PORT_SIZE / 2) / NODE_WIDTH) * 100}%`;
  const centerYPercent = `${(((port.y ?? 0) + PORT_SIZE / 2) / NODE_HEIGHT) * 100}%`;

  if (handleId.startsWith('target-top')) {
    return { top: -6, left: centerXPercent };
  }
  if (handleId.startsWith('target-left') || handleId.startsWith('source-left')) {
    return { left: -6, top: centerYPercent };
  }
  if (handleId.startsWith('target-right') || handleId.startsWith('source-right')) {
    return { right: -6, top: centerYPercent };
  }
  return { bottom: -6, left: centerXPercent };
}

const CfgNode = memo(function CfgNode({ data }: NodeProps<CfgNodeData>) {
  return (
    <div className="cfg-node-shell">
      {data.handles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type={handle.type}
          position={handle.position}
          isConnectable={false}
          className="cfg-port-hidden"
          style={handle.style}
        />
      ))}

      <div className="cfg-node-label">
        <div className="cfg-node-type">{data.nodeType}</div>
        <div className="cfg-node-title">{data.label}</div>
        {data.lineRange && <div className="cfg-node-meta">{data.lineRange}</div>}
      </div>
    </div>
  );
});

const nodeTypes = {
  cfgNode: CfgNode,
};

const CfgEdge = memo(function CfgEdge({ id, data, markerEnd, style }: EdgeProps<CfgEdgeData>) {
  if (!data || data.points.length < 2) {
    return null;
  }

  const labelPosition = findLabelPosition(data.points);

  return (
    <>
      <BaseEdge id={id} path={buildPath(data.points)} markerEnd={markerEnd} style={style} />
      {data.label && (
        <EdgeLabelRenderer>
          <div
            className="cfg-edge-label"
            style={{
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
            }}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});

const edgeTypes = {
  cfgEdge: CfgEdge,
};

function toReactFlowGraph(cfg: FunctionCfgResponse, layoutedGraph: ElkNode): { nodes: Node<CfgNodeData>[]; edges: Edge[] } {
  const nodesFromLayout = layoutedGraph.children ?? [];
  const nodeById = new Map(cfg.nodes.map((node) => [node.id, node]));
  const elkEdges = layoutedGraph.edges ?? [];
  const layoutNodeInfos = new Map<string, LayoutNodeInfo>(
    nodesFromLayout.map((node) => [
      node.id,
      {
        node,
        bounds: buildNodeBounds(node),
        portsByHandleId: new Map((node.ports ?? []).map((port) => [port.id.replace(`${node.id}:`, ''), port])),
      },
    ]),
  );
  const fallbackPointsByEdgeId = new Map(elkEdges.map((edge) => [edge.id, extractSectionPoints(edge)]));
  const routedPointsByEdgeId = buildRoutedEdgePoints(cfg, layoutNodeInfos, fallbackPointsByEdgeId);

  const flowNodes: Node<CfgNodeData>[] = nodesFromLayout.map((node) => {
    const source = nodeById.get(node.id);
    if (!source) {
      throw new Error(`Missing node payload for ${node.id}`);
    }

    const handles: CfgHandleData[] = (node.ports ?? []).map((port) => {
      const handleId = port.id.replace(`${node.id}:`, '');
      return {
        id: handleId,
        type: handleTypeFromId(handleId),
        position: handlePositionFromId(handleId),
        style: buildHandleStyle(port, handleId),
      };
    });

    return {
      id: node.id,
      type: 'cfgNode',
      position: {
        x: node.x ?? 0,
        y: node.y ?? 0,
      },
      draggable: false,
      selectable: false,
      data: {
        nodeType: source.type,
        label: source.label,
        lineRange: formatLineRange(source.startLine, source.endLine),
        startLine: source.startLine,
        endLine: source.endLine,
        handles,
      },
      style: {
        ...nodeStyle(source.type),
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        borderWidth: 1.5,
        borderRadius: 18,
        boxShadow: '0 10px 22px rgb(47 36 25 / 10%)',
        padding: 0,
        fontSize: 12,
        cursor: source.startLine != null ? 'pointer' : 'default',
      },
    };
  });

  const flowEdges: Edge[] = cfg.edges.map((edge) => {
    const points = routedPointsByEdgeId.get(edge.id) ?? [];
    const stroke = edgeTone(edge.label);
    const sourceNode = nodeById.get(edge.source);
    if (!sourceNode) {
      throw new Error(`Missing source node for edge ${edge.id}`);
    }

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: resolveSourceHandleId(sourceNode, edge.id, edge.label),
      targetHandle: resolveTargetHandleId(edge.id, edge.label),
      type: 'cfgEdge',
      data: {
        points,
        label: edge.label,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: stroke,
      },
      style: {
        stroke,
        strokeWidth: edge.label === 'loop' ? 2.1 : 1.95,
        strokeDasharray: edge.label === 'loop' ? '8 6' : undefined,
      },
      zIndex: edge.label === 'loop' ? 0 : 2,
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export function CfgGraph({ cfg, isLoading, onNodeSelect }: CfgGraphProps) {
  const [graph, setGraph] = useState<{ nodes: Node<CfgNodeData>[]; edges: Edge[] }>({ nodes: [], edges: [] });
  const [isLayouting, setIsLayouting] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    if (!cfg) {
      setGraph({ nodes: [], edges: [] });
      setIsLayouting(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLayouting(true);

    void elk
      .layout(buildElkGraph(cfg))
      .then((layoutedGraph) => {
        if (isCancelled) {
          return;
        }
        setGraph(toReactFlowGraph(cfg, layoutedGraph));
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }
        setGraph({ nodes: [], edges: [] });
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLayouting(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [cfg]);

  const isBusy = isLoading || isLayouting;
  const fitViewOptions = useMemo(() => ({ padding: 0.24 }), []);
  const formulaMetrics = useMemo(() => {
    if (!cfg) {
      return null;
    }

    const edgeCount = cfg.edges.length;
    const nodeCount = cfg.nodes.length;

    return {
      edgeCount,
      nodeCount,
      formulaValue: edgeCount - nodeCount + 2,
    };
  }, [cfg]);

  if (isBusy) {
    return <LoadingState message="Loading control flow graph..." className="analysis-loading" />;
  }

  if (!cfg) {
    return <div className="analysis-empty-state">Run analysis and select a function to inspect its CFG.</div>;
  }

  if (graph.nodes.length === 0) {
    return <div className="analysis-empty-state">Unable to render CFG layout for this function.</div>;
  }

  return (
    <div className="analysis-graph-shell">
      {formulaMetrics && (
        <div className="cfg-formula-bar" aria-label="CFG formula summary">
          <span className="cfg-formula-chip">E = {formulaMetrics.edgeCount}</span>
          <span className="cfg-formula-chip">N = {formulaMetrics.nodeCount}</span>
          <code className="cfg-formula-expression">E - N + 2 = {formulaMetrics.formulaValue}</code>
        </div>
      )}

      <div className="analysis-graph">
        <ReactFlow
          key={cfg.functionId}
          nodes={graph.nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={fitViewOptions}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnDrag
          zoomOnScroll
          minZoom={0.25}
          maxZoom={1.4}
          onNodeClick={(_, node) => {
            const { startLine, endLine } = node.data as CfgNodeData;
            if (startLine == null) {
              return;
            }
            onNodeSelect(startLine, endLine);
          }}
        >
          <Background color="#eadfce" gap={18} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
