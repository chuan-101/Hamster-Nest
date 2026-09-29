// Parse registration names without importing or executing Deno application code.
import ts from 'typescript'

export function scanToolNames(source, filename = 'index.ts') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  if (file.parseDiagnostics.length) throw new Error(`${filename}: invalid TypeScript`)
  const constants = new Map()
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement) || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        constants.set(declaration.name.text, declaration.initializer)
      }
    }
  }

  const fail = (node) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file))
    throw new Error(`${filename}:${line + 1}: cannot statically resolve MCP registration; extend the inventory parser`)
  }
  const evaluate = (node, scope, resolving = new Set()) => {
    if (!node) throw new Error(`${filename}: missing MCP registration name`)
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
      return evaluate(node.expression, scope, resolving)
    }
    if (ts.isIdentifier(node)) {
      if (scope.has(node.text)) return scope.get(node.text)
      if (!constants.has(node.text) || resolving.has(node.text)) return fail(node)
      return evaluate(constants.get(node.text), scope, new Set([...resolving, node.text]))
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.map((entry) => evaluate(entry, scope, resolving))
    if (ts.isObjectLiteralExpression(node)) {
      const object = Object.create(null)
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || ts.isComputedPropertyName(property.name)) return fail(property)
        object[property.name.text] = evaluate(property.initializer, scope, resolving)
      }
      return object
    }
    if (ts.isPropertyAccessExpression(node)) {
      const object = evaluate(node.expression, scope, resolving)
      if (!object || !Object.hasOwn(object, node.name.text)) return fail(node)
      return object[node.name.text]
    }
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      for (const span of node.templateSpans) {
        const value = evaluate(span.expression, scope, resolving)
        if (typeof value !== 'string') return fail(span.expression)
        text += value + span.literal.text
      }
      return text
    }
    return fail(node)
  }

  const isRegistration = (node) => ts.isCallExpression(node) && (
    (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'registerTool') ||
    (ts.isElementAccessExpression(node.expression) && ts.isStringLiteral(node.expression.argumentExpression) &&
      node.expression.argumentExpression.text === 'registerTool')
  )
  const containsRegistration = (node) => isRegistration(node) || Boolean(ts.forEachChild(node, containsRegistration))
  const names = []
  const visit = (node, scope) => {
    if (isRegistration(node)) {
      const name = evaluate(node.arguments[0], scope)
      if (typeof name !== 'string' || !name) return fail(node)
      names.push(name)
      return
    }
    if (ts.isForOfStatement(node) && containsRegistration(node.statement)) {
      const declarations = node.initializer.declarations
      if (!ts.isVariableDeclarationList(node.initializer) || declarations.length !== 1 ||
        !ts.isIdentifier(declarations[0].name)) return fail(node)
      const configs = evaluate(node.expression, scope)
      if (!Array.isArray(configs)) return fail(node.expression)
      for (const config of configs) {
        visit(node.statement, new Map([...scope, [declarations[0].name.text, config]]))
      }
      return
    }
    // Conditional / other loop-based registration needs an explicit parser extension,
    // rather than silently counting both branches or only one iteration.
    if ((ts.isIfStatement(node) || ts.isConditionalExpression(node) || ts.isSwitchStatement(node) ||
      ts.isForStatement(node) || ts.isForInStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) &&
      containsRegistration(node)) return fail(node)
    ts.forEachChild(node, (child) => visit(child, scope))
  }
  visit(file, new Map())
  if (new Set(names).size !== names.length) throw new Error(`${filename}: duplicate MCP tool names`)
  return names.sort()
}
