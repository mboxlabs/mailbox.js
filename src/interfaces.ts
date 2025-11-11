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
  id?: string;
  from: URL | string;
  to:URL | string;
  body: any;
  headers?: {
    'x-reply-to'?: string;
    'x-sent-at'?: string;
    [key: string]: any;
  };
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
 * Provider 在发送时，有责任向 headers 中注入 `x-sent-at` 时间戳 (ISO 8601 格式)。
 */
export interface IMailboxProvider {
  protocol: string;

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
