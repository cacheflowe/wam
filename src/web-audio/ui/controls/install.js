/**
 * Install feature method groups onto a class prototype.
 *
 * WebAudioControlsBase is split across ui/controls/*.js: each file declares a
 * plain class whose methods / accessors are copied onto the base prototype
 * (property descriptors, so getters/setters keep working). Subclasses sit
 * above the base in the prototype chain, so their overrides still win.
 *
 * Throws if two groups (or a group and the class itself) define the same name —
 * a split must never silently replace a method.
 *
 * @param {Function} target  class to extend (e.g. WebAudioControlsBase)
 * @param {Function[]} groups  feature classes (never instantiated)
 */
export function installMethods(target, groups) {
  const proto = target.prototype;
  for (const group of groups) {
    for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(group.prototype))) {
      if (name === "constructor") continue;
      if (Object.prototype.hasOwnProperty.call(proto, name)) {
        throw new Error(`installMethods: ${target.name}.${name} is already defined (from ${group.name})`);
      }
      Object.defineProperty(proto, name, desc);
    }
  }
}
