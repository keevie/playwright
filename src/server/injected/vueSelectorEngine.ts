/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SelectorEngine, SelectorRoot } from './selectorEngine';

type ComponentNode = {
  name: string,
  children: ComponentNode[],
  rootElements: Element[],
};

type VueVNode = {
  // Vue3
  type: any,
  root?: any,
  parent?: VueVNode,
  appContext?: any,
  _isBeingDestroyed?: any,
  isUnmounted?: any,
  subTree: any,

  // Vue2
  $children?: VueVNode[],
  fnOptions?: any,
  $options?: any,
  $root?: VueVNode,
  $el?: Element,
};

// @see https://github.com/vuejs/devtools/blob/14085e25313bcf8ffcb55f9092a40bc0fe3ac11c/packages/shared-utils/src/util.ts#L295
function basename(filename: string, ext: string): string {
  const normalized = filename.replace(/^[a-zA-Z]:/, '').replace(/\\/g, '/');
  let result = normalized.substring(normalized.lastIndexOf('/') + 1);
  if (ext && result.endsWith(ext))
    result = result.substring(0, result.length - ext.length);
  return result;
}

// @see https://github.com/vuejs/devtools/blob/14085e25313bcf8ffcb55f9092a40bc0fe3ac11c/packages/shared-utils/src/util.ts#L41
function toUpper(_: any, c: string): string {
  return c ? c.toUpperCase() : '';
}

// @see https://github.com/vuejs/devtools/blob/14085e25313bcf8ffcb55f9092a40bc0fe3ac11c/packages/shared-utils/src/util.ts#L23
const classifyRE = /(?:^|[-_/])(\w)/g;
const classify = (str: string) => {
  return str && str.replace(classifyRE, toUpper);
};

function buildComponentsTreeVue3(instance: VueVNode): ComponentNode {
  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/util.ts#L47
  function getComponentTypeName(options: any): string|undefined {
    const name = options.name || options._componentTag || options.__playwright_guessedName;
    if (name)
      return name;
    const file = options.__file; // injected by vue-loader
    if (file)
      return classify(basename(file, '.vue'));
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/util.ts#L42
  function saveComponentName(instance: VueVNode, key: string): string {
    instance.type.__playwright_guessedName = key;
    return key;
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/util.ts#L29
  function getInstanceName(instance: VueVNode): string {
    const name = getComponentTypeName(instance.type || {});
    if (name) return name;
    if (instance.root === instance) return 'Root';
    for (const key in instance.parent?.type?.components)
      if (instance.parent?.type.components[key] === instance.type) return saveComponentName(instance, key);
    for (const key in instance.appContext?.components)
      if (instance.appContext.components[key] === instance.type) return saveComponentName(instance, key);
    return 'Anonymous Component';
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/util.ts#L6
  function isBeingDestroyed(instance: VueVNode): boolean {
    return instance._isBeingDestroyed || instance.isUnmounted;
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/util.ts#L16
  function isFragment(instance: VueVNode): boolean {
    return instance.subTree.type.toString() === 'Symbol(Fragment)';
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/tree.ts#L79
  function getInternalInstanceChildren(subTree: any): VueVNode[] {
    const list = [];
    if (subTree.component)
      list.push(subTree.component);
    if (subTree.suspense)
      list.push(...getInternalInstanceChildren(subTree.suspense.activeBranch));
    if (Array.isArray(subTree.children)) {
      subTree.children.forEach((childSubTree: any) => {
        if (childSubTree.component)
          list.push(childSubTree.component);
        else
          list.push(...getInternalInstanceChildren(childSubTree));
      });
    }
    return list.filter(child => !isBeingDestroyed(child) && !child.type.devtools?.hide);
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/el.ts#L8
  function getRootElementsFromComponentInstance(instance: VueVNode): Element[] {
    if (isFragment(instance))
      return getFragmentRootElements(instance.subTree);
    return [instance.subTree.el];
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue3/src/components/el.ts#L15
  function getFragmentRootElements(vnode: any): Element[] {
    if (!vnode.children) return [];

    const list = [];

    for (let i = 0, l = vnode.children.length; i < l; i++) {
      const childVnode = vnode.children[i];
      if (childVnode.component)
        list.push(...getRootElementsFromComponentInstance(childVnode.component));
      else if (childVnode.el)
        list.push(childVnode.el);
    }
    return list;
  }

  function buildComponentsTree(instance: VueVNode): ComponentNode {
    return {
      name: getInstanceName(instance),
      children: getInternalInstanceChildren(instance.subTree).map(buildComponentsTree),
      rootElements: getRootElementsFromComponentInstance(instance),
    };
  }

  return buildComponentsTree(instance);
}

function buildComponentsTreeVue2(instance: VueVNode): ComponentNode {
  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/shared-utils/src/util.ts#L302
  function getComponentName(options: any): string|undefined {
    const name = options.displayName || options.name || options._componentTag;
    if (name)
      return name;
    const file = options.__file; // injected by vue-loader
    if (file)
      return classify(basename(file, '.vue'));
  }

  // @see https://github.com/vuejs/devtools/blob/e7132f3392b975e39e1d9a23cf30456c270099c2/packages/app-backend-vue2/src/components/util.ts#L10
  function getInstanceName(instance: VueVNode): string {
    const name = getComponentName(instance.$options || instance.fnOptions || {});
    if (name)
      return name;
    return instance.$root === instance ? 'Root' : 'Anonymous Component';
  }

  // @see https://github.com/vuejs/devtools/blob/14085e25313bcf8ffcb55f9092a40bc0fe3ac11c/packages/app-backend-vue2/src/components/tree.ts#L103
  function getInternalInstanceChildren(instance: VueVNode): VueVNode[] {
    if (instance.$children)
      return instance.$children;
    if (Array.isArray(instance.subTree.children))
      return instance.subTree.children.filter((vnode: any) => !!vnode.component).map((vnode: any) => vnode.component);
    return [];
  }

  function buildComponentsTree(instance: VueVNode): ComponentNode {
    return {
      name: getInstanceName(instance),
      children: getInternalInstanceChildren(instance).map(buildComponentsTree),
      rootElements: [instance.$el!],
    };
  }

  return buildComponentsTree(instance);
}

function filterComponentsTree(treeNode: ComponentNode, searchFn: (node: ComponentNode) => boolean, result: ComponentNode[] = []): ComponentNode[] {
  if (searchFn(treeNode))
    result.push(treeNode);
  for (const child of treeNode.children)
    filterComponentsTree(child, searchFn, result);
  return result;
}

function findVueRoot(): undefined|{version: number, root: VueVNode} {
  const walker = document.createTreeWalker(document);
  while (walker.nextNode()) {
    // Vue3 root
    if ((walker.currentNode as any)._vnode && (walker.currentNode as any)._vnode.component)
      return {root: (walker.currentNode as any)._vnode.component, version: 3};
    // Vue2 root
    if ((walker.currentNode as any).__vue__)
      return {root: (walker.currentNode as any).__vue__, version: 2};
  }
  return undefined;
}

export const VueEngine: SelectorEngine = {
  queryAll(scope: SelectorRoot, name: string): Element[] {
    const vueRoot = findVueRoot();
    if (!vueRoot)
      return [];
    const tree = vueRoot.version === 3 ? buildComponentsTreeVue3(vueRoot.root) : buildComponentsTreeVue2(vueRoot.root);
    const treeNodes = filterComponentsTree(tree, treeNode => {
      if (treeNode.name !== name)
        return false;
      if (treeNode.rootElements.some(rootElement => !scope.contains(rootElement)))
        return false;
      return true;
    });
    const allRootElements: Set<Element> = new Set();
    for (const treeNode of treeNodes) {
      for (const rootElement of treeNode.rootElements)
        allRootElements.add(rootElement);
    }
    return [...allRootElements];
  }
};
