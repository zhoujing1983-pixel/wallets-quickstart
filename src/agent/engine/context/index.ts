/*
 * 文件作用：执行上下文模型定义：声明 workflow 执行阶段、决策与失败策略所需的数据结构和守卫函数。
 * 调用链阶段：VoltAgent 执行阶段（workflow 定义与引擎装配）
 * 调用链关系：上游：src/agent/engine/workflow/*.ts::import context 类型；下游：src/agent/engine/context/*.ts 具体接口导出。
 * 维护说明：新增/修改本文件时，应保持输入输出契约稳定，避免破坏上游调用方与下游被调方的方法签名。
 */
/*
 * Context 统一出口：
 * - 封装执行上下文与初始化方法；
 * - 便于上层一次性导入。
 */
export * from "./ExecutionContext";
export * from "./createContext";