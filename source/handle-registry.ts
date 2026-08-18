/** Weak canonical references for system-backed domain handles in this SDK realm. */
export default class HandleRegistry {
  private readonly handles = new Map<string, WeakRef<object>>()
  private readonly released = new FinalizationRegistry<Released>(({ key, reference }) => {
    if (this.handles.get(key) === reference) this.handles.delete(key)
  })

  public obtain<Value extends object>(key: string, create: () => Value): Value {
    const existing = this.handles.get(key)?.deref() as Value | undefined
    if (existing) return existing

    const value = create()
    const reference = new WeakRef(value)
    this.handles.set(key, reference)
    this.released.register(value, { key, reference })
    return value
  }

  public adopt<Value extends object>(key: string, value: Value): Value {
    const existing = this.handles.get(key)?.deref()
    if (existing && existing !== value) throw new Error(`The canonical handle for "${key}" already exists`)
    return (existing as Value | undefined) ?? this.obtain(key, () => value)
  }
}

type Released = Readonly<{ key: string, reference: WeakRef<object> }>
