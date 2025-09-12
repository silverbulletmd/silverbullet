/**
 * A proxy class that enables swapping out the target object later on
 */
export class BoxProxy {
  /**
   * Initializes a new instance of the BoxProxy class.
   * @param target The initial target object
   */
  constructor(private target: any) {
  }

  /**
   * Swaps out the target object :magic:
   */
  setTarget(target: any) {
    this.target = target;
  }

  /**
   * Builds a proxy object that forwards everything we care about to the target object
   */
  buildProxy() {
    return new Proxy(this, {
      get: (_obj: any, prop) => {
        return this.target[prop];
      },
      set: (_obj: any, prop, value) => {
        this.target[prop] = value;
        return true;
      },
      has: (_obj: any, prop) => {
        return prop in this.target;
      },
      deleteProperty: (_obj: any, prop) => {
        delete this.target[prop];
        return true;
      },
      ownKeys: (_obj: any) => {
        return Object.keys(this.target);
      },
      getOwnPropertyDescriptor: (_obj: any, prop) => {
        return Object.getOwnPropertyDescriptor(this.target, prop);
      },
    });
  }
}
