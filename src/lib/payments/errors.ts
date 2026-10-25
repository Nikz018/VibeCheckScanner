export class PaymentRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentRequestError";
  }
}

export class PaymentNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentNotConfiguredError";
  }
}

export class MissingSignatureError extends Error {
  constructor() {
    super("Missing signature.");
    this.name = "MissingSignatureError";
  }
}

export class InvalidSignatureError extends Error {
  constructor() {
    super("Invalid signature.");
    this.name = "InvalidSignatureError";
  }
}
