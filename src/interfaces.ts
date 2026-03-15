/**
 * 代表一个活跃的订阅会话。
 */
export interface Subscription {
  readonly id: string;
  readonly address: URL;
  status: 'active' | 'connecting' | 'paused' | 'closed';
  unsubscribe(): Promise<void>;
}

/**
 * 代表一封待发送的信件。
 * 这是用户在调用 post() 方法时需要构建的对象。
 */
export interface OutgoingMail {
  /**
   * 消息的物理唯一标识。如果未提供，Mailbox 将自动生成。
   *
   * 建议与消息内容绑定（如使用内容的 Hash），以便实现【内容级幂等】。
   * 邮箱系统通过此 ID 识别并丢弃内容重复的信件，确保同一份信息不会被物理重复投递。
   */
  id?: string;
  from: URL | string;
  to:URL | string;
  body: any;
  /**
   * Mailbox 框架及其生态约定的控制信息（控制平面），用于指导消息的传输、路由、认证和关联。
   *
   * 标准 Header 约定：
   * - `req-id`: 请求标识 (Request ID)。用于在异步交互中匹配请求与响应。
   *   在运输层，它作为单次交互的关联键，同时用于处理网络重传导致的【请求级去重】。
   *   每次请求应生成独立的 req-id 以确保当前闭环。
   * - `trace-id`: 全链路追踪标识 (Trace ID)。由业务源头生成并在整个生命周期中透传。
   *   用于跨多个 Request 串联起完整的业务流日志，是解决分布式复杂拓扑下可观测性问题的关键。
   * - `mbx-reply-to`: 邮箱系统标准的回复地址。指明响应消息应发往的 Mailbox 地址。
   * - `mbx-sent-at`: 发送时间戳 (ISO 8601)。由 Provider 在发送时自动注入。
   *   代表消息正式进入传输系统的时刻，是审计消息时效、监控传输延迟的权威标准。
   */
  headers?: {
    'req-id'?: string;
    'trace-id'?: string;
    'mbx-reply-to'?: string;
    'mbx-sent-at'?: string;
    [key: string]: any;
  };
  /**
   * 本邮件消息的附加数据（邮件的数据平面），是消息的业务内容的补充元信息，由业务应用自定义和使用。
   * 系统只负责透传，不进行解析和干预。本质上是邮件的一部分。
   */
  meta?: { [key: string]: any; };
}

/**
 * 代表一封在系统内传递的、带有唯一标识的规范信件。
 * 这是在 Mailbox 与 Provider 之间传递的主要对象。
 * 消费者收到的也是此类型的消息。
 */
export interface MailMessage extends Omit<OutgoingMail, 'from' | 'to'> {
  readonly id: string;
  readonly from: URL;
  readonly to: URL;
}

/**
 * 代表一个可被手动确认或拒绝的信件。
 */
export interface Ackable {
  /**
   * 确认消息已被成功处理。
   * Provider 将会通知消息队列彻底删除此消息。
   */
  ack(): Promise<void>;

  /**
   * 拒绝消息。
   * @param requeue 如果为 true，请求消息队列将此消息重新放回，使其可以被再次消费。
   *                如果为 false，消息将被丢弃或移入死信队列。
   */
  nack(requeue?: boolean): Promise<void>;
}

export type AckableMailMessage = MailMessage & Ackable;

/**
 * 代表一个邮箱地址的状态信息。
 */
export interface MailboxStatus {
  /**
   * 提供者自身的连接或运行状态。
   */
  state: 'online' | 'offline' | 'degraded' | 'unknown';
  /**
   * 队列中未被消费的消息数量。
   */
  unreadCount?: number;
  /**
   * 最后一次有消息活动（发送或接收）的时间 (ISO 8601 格式)。
   */
  lastActivityTime?: string;

  /**
   * 索引签名，允许 MailboxStatus 包含任意其他字符串键的属性。
   * 这些属性将作为提供者特定的扩展信息。
   */
  [key: string]: any;
}

/**
 * 定义了所有具体通信方式必须实现的接口。
 * Provider 在发送时，有责任向 headers 中注入 `mbx-sent-at` 时间戳 (ISO 8601 格式)。
 */
export interface IMailboxProvider {
  protocol: string;

  /**
   * 初始化 Provider。用于建立连接、验证配置等。
   */
  init?(): Promise<void>;

  /**
   * 关闭 Provider。用于释放资源、断开连接等。
   */
  close?(): Promise<void>;

  send(message: MailMessage): Promise<MailMessage>;

  /**
   * 【订阅模式】订阅一个地址，当有信件到达时触发回调。
   * 确认机制为隐式ACK：当 onReceive 函数成功执行，消息被自动确认。
   * 发生异常时，将根据错误类型决定是重试还是移入死信队列。
   */
  subscribe(address: URL, onReceive: (message: MailMessage) => void | Promise<void>): Subscription;

  /**
   * 【拉取模式】从指定地址主动拉取一封信件。
   * 支持自动ACK (默认) 和手动ACK两种模式。
   */
  fetch(address: URL, options: { manualAck: true }): Promise<AckableMailMessage | null>;
  fetch(address: URL, options?: { manualAck?: false }): Promise<MailMessage | null>;
  fetch(address: URL, options?: { manualAck?: boolean }): Promise<MailMessage | AckableMailMessage | null>;

  /**
   * 查询指定地址的状态。
   * 这是一个可选实现的方法。如果 Provider 不支持，可以抛出 "Not Implemented" 错误或返回一个默认状态。
   * @param address 要查询状态的地址。
   * @returns 返回地址的状态信息。
   */
  status?(address: URL): Promise<MailboxStatus>;

  /**
   * 创建一个唯一标识符。主要是用于生成邮件的 ID。
   */
  generateId(): string;
}
