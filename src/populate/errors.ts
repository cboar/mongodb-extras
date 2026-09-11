type UnresolvedReason = 'not-found' | 'unkeyable'

export class PopulateUnresolvedError extends Error {
  readonly code = 'POPULATE_UNRESOLVED'
  readonly path: string
  readonly foreignKey: string
  readonly reason: UnresolvedReason
  readonly index?: number

  constructor(details: {
    path: string
    foreignKey: string
    reason: UnresolvedReason
    index?: number
  }) {
    const { path, foreignKey, reason, index } = details
    super(
      `Unresolved populate reference at "${path}"${index === undefined ? '' : ` [${index}]`}: ${reason}`,
    )
    this.name = 'PopulateUnresolvedError'
    this.path = path
    this.foreignKey = foreignKey
    this.reason = reason
    this.index = index
  }
}
