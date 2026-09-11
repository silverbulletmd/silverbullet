local accounts = {}
local identities = {}

system = {
  listAccounts = function() return accounts end,
  invokeFunction = function() return identities end,
}

accounts = { { username = nil, me = true } }
identities = { { name = "self", id = "@self", detail = "you" } }
local own = identity.own()
assert(own.name == "self", "a nameless owner should resolve as self")
assert(own.id == "@self", "a nameless owner's id should be @self")

accounts = {}
identities = { { name = "self", id = "@self", detail = "you" } }
assert(identity.own() == nil, "an anonymous visitor should have no identity")

accounts = { { username = "Ada", me = true } }
identities = { { name = "ada", id = "@ada", detail = "you" } }
assert(identity.own().id == "@ada", "a named owner should keep their username")
