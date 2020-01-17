# DPScript Language specification

DPScript, or The Minecraft Datapack scripting language, is a custom programming language designed specifically for generating custom Minecraft datapacks for creating custom behavior and mechanics.

The language uses files with extension `.dps`, and this extension for Visual Studio Code will automatically validate and autocomplete your code.

## Basic Datapack tutorial

A dpscript file for creating mcfunctions uses `function` blocks to declare the code that will be translated to `.mcfunction` files.

For example, here is a .dps file that will print to the chat "Hello World" every tick:

```txt
// main.dps

tick {
  print("Hello World")
}
```

This code will compile to this .mcfuntion file:

```txt
// loop.mcfunction
say Hello World
```

### Selectors

In minecraft commands, entity selectors are used to select and target entities in the world using various filters. In dpscript, this had been made a lot easier using some cool shorthands.

For instance, if you want to select the closest 5 creepers, in minecaft it'll be `@e[type=creeper,sort=nearest,limit=5]`, but in DPScript it'll be `@creeper[nearest]*5`.

The selectors have many methods and fields, like `@e.kill()`, `@a.title("Hello!")` etc. For a full list of the selector members, refer to [Langauge Reference/Selector Members](#selector-members).

## Language reference

Full documentation of the language.

### Selector Members

**effect**
`@e.effect(<effect>)`
Gives a status effect to the entity.
`effect`: The effect to give: [syntax](#effect-syntax)

`@e.effect(<effectID>) {clear / remove / cure}`
Clears the specified effect from the entity.
`effectID`: The minecraft ID of the effect. Aliases are allowed, like `regen` or `fire_res`.

*Example*: `@a.grant(from minecraft:story/mine_stone)`

**grant/revoke**
`@a.grant([all / everything])`
Grants or revokes all advancements to the player

`@a.grant(from <advancement>)`
Grants or revokes all advancements in a tree starting from the specified advancement.
`advancement`: The parent advancement ID

`@a.revoke([only] <advancement>[[<criterion>]])`
Grants or revokes a single advancement
`advancement`: The advancement ID to grant/revoke.
`criterion`: An optional criterion name to only grant/revoke it, rather than the whole advancement. Specified inside square parentheses after the advancement ID.

**clear**
`@a.clear(<item>)`
Clears the specified item from the player's inventory
`item`: The item to clear. [syntax](#item-syntax)

*Example*: `@a.clear(diamond * 64)`

**nbt**
Alias: `data`
`@e.nbt = <nbt>`
Merges the specified NBT to the entity NBT.
`nbt`: The NBT tag to merger

`@e.nbt[<path>] = <type>(<statement>)[.{result/success}] [* <scale>]`
`path`: The nbt path string to store into, for example `"Health"`, `"Inventory[0]"`
`type`: The type to convert the result NBT value to. Can be byte/short/int/long/float/double.
`statement`: Any statement to get the result from.
`.result/success`: Specify whether to use the query result or just 1 for success and 0 for fail.
`scale`: A scale factor of the result.
*Example*: `@creeper.nbt["Fuse"] = int(@p.myObjective).result * 0.1`

`@e.nbt[<path>] = <NBTSource>`
Sets the value at the specified path to the specified NBT source.
`NBTSource`: The source to get the value from. [syntax](#nbt-source-syntax)

`@e.nbt[<path>].remove()`
Removes the NBT value at the specified path.

`@e.nbt[<path>].insert(<index>,<NBTSource>)`
Inserts the specified NBT value at the specified index in an NBT list.

### Effect Syntax

Effect syntax:
`<effectID> [<tier>] [, <duration> [hide]]`
`effectID`: The minecraft ID of the effect. Aliases are allowed, like `regen` or `fire_res`.
`tier`: Optional effect amplifier, for stronger effects. Can be any number, and 0 means tier 1, 1 means tier 2, etc. You can also use roman numbers, as such that I is tier 1, IV is tier 4. If omitted, defaults to tier 1.
`duration`: The duration the status effect will last. You can use any combination of numbers followed by unit character. Examples: `5s` = 5 seconds, `10mins 15s` = 10 minutes and 15 seconds, `100` = 100 seconds.
`hide`: Add the `hide` keyword at the end to disable effect particles.

### Item Syntax

`<itemID> [<nbt>] [ * <count>]`
`itemID`: The item minecraft ID.
`nbt`: Optional NBT value
`count`: The item count, after an optional *.

### NBT Source Syntax
