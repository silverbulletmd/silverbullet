**TL;DR:** Please do not (heavily) use LLM-based coding tools to contribute code to the [main SilverBullet code base](https://github.com/silverbulletmd/silverbullet). Also don’t heavily rely on LLMs to contribute to issues or community discussions (except for language support, if you need it).

The topic of how to deal with (largely) LLM generated contributions comes up from time in SilverBullet. Different open source project take different approaches: some allow them because “it’s the future,” some [decidedly do not](https://ziglang.org/code-of-conduct/). After much deliberation, I decided that for now I’ll put SilverBullet in the latter camp, as in: no thank you. 

There are two main reasons for this, the first is _moral_, a second more _practical_.

# The moral reason
I have been open sourcing code for over 25 years. My goals for doing so include helping people solve similar problems that I have, enjoy and benefit from the software I build, to allow them to adapt, improve, change and learn from it, and to build community. I have always distributed code under the most liberal of licenses (usually MIT), and have been lucky enough that those licenses were not exploited. Until recently, when LLMs came around.

Specifically _not_ on my list of goals was allowing companies to take my code (or content in general) as input to a _ridiculously_ resource-intensive (money, energy, cheap labor) algorithm, and have the result be sold back to me in the form of tokens. Yet, here we are. And while some may have the sentiment that this is fine, and perhaps even legal, I’m not too happy about it.

There are various areas in my life where I have to make more pragmatic choices, but in my open source work I feel I can afford to take a stand.

Therefore, the first reason to ask you not to contribute to SilverBullet using AI tools is a **moral** one: these tools are built by scraping all text (natural and code) LLM companies can get their hands on (often in sketchy ways), use scarce resources to train and operate them, and disproportionally benefit companies with highly questionable morals. This is not a cause I am interested in associating or supporting in my leisure time.

# The practical reason
The second reason is more practical. While there is a bubble of people that claim that the quality of the work produced by LLMs is amazing, this has not been my experience based on using these tools myself and reviewing the work of these tools done by others. Too often, it is _sloppy_.

From time to time people “contribute” to issues or the community forums with largely LLM generated text. At best it’s just a lot of text easily detected as LLM slop and ignored, at worst it contains inaccurate information that simply detracts the conversation or results in investing time in things that are simply hallucinated. This is not helpful.

In the context of code contributions, while sloppy work is not unique to LLMs, the pace and ease in which it produces it definitely is. If I would have enough faith in LLMs to either feel I do not have to do code reviews, or I can delegate all reviews to LLMs — this could _hypothetically_ be ok. However, again, this is not my experience. The work produced by LLMs if often bad, and I have little reason to believe that an LLM code review would detect it.

This means that _I still have to review everything myself._

There is an important difference in reviewing code produced by an LLM and a human.

With humans, even in an open source setting, you build some level of relationship over time. You build trust. In the SilverBullet project I have a few people where I’ve seen their work, I know they can be trusted to do great, and I don’t have to zoom in on every single change. This is great, and is one of the reasons why a project with the scope size of SilverBullet can still be run by a single person. When I invest time in giving a detailed code review, I think _learning_ can happen. The person on the other end, or so I would like to believe, considers things they hadn’t considered before, learns more about the internal workings of SilverBullet, or potentially about how to write code in general.

This is not the case with an LLM. Sure, in “best practice” scenarios, the LLM output is first reviewed by a skilled human before being submitted for a code review. My lived experience (also observing my own behavior) is that people get lazy quickly. I have had a period in which I was more trusting of AI coding agents and let them go rampant on the SilverBullet code base. I’m still cleaning up the technical debt and mess that it produced in just a few months, _and I completely missed it at the time_. If I cannot trust _myself_ to do this — and I definitely have an incentive — how can I trust random _others_ to do this?

This means that I have to review every single line of LLM produced code and never get lazy. I have seen cases where a _comment_ produced by the LLM “documented” a certain behavior, and implemented the opposite. I’ve seen LLMs make mistakes a human could not conceivably make. I’ve seen LLMs making code more “robust” by simply littering it with null checks rather than reasoning about why those may actually happen. The level of attention I have to pay in an LLM generated pull request is _higher_ than when it is produced by a human. There is often a disorienting big discrepancy between how it _looks_ and what it actually _is_.

The ease and pace at which an AI agent produces a full pull request with meticulous sounding description and thousands of lines of code added (many of which are “tests”) is impressive. However, because of reasons listed before, now _my part starts_. I now have to go through this code for _hours or even days_ that only took _minutes_ to produce. 

This is not a fair game, and I’m not here for it. I’m sure your intention is good, but it’s often simply counter productive.

# Enforcement
I’m not the type of person that is interested in strict rules and policing. My approach is always to focus on explaining the _why_ and giving context so that people can draw their own conclusions.

If I suspect that your contribution is AI generated, I will likely close it pointing to this policy. I may get it wrong sometimes, I’m sorry about that. I’m only human, consider being the same.

# What this means for you
So, is the target audience of SilverBullet just #NoAI people, then? No. _Especially_ a tool like SilverBullet is all about self-expression: your notes, your thoughts, your system, your crazy experiments. I know that people use LLMs to write [[Space Lua]] scripts, and I’m happy for them. I know that LLMs help people do things that they could not do before, and even learn things in the process. That’s great. Open source is all about freedom. Do with it what you like, use it as you like. There is a solid [SilverBullet AI library](https://github.com/justyns/silverbullet-ai) if you’re interested.

This policy only applies to the SilverBullet code base itself and its community. It is the code that I feel I should be able to understand and own, and the conversations that I decide to spend my time on contributing to. I have to make decisions that keep the project going and sustainable long term, and excessive use of AI tools in contributions puts that at risk.

I hope that makes sense.

— [[Zef]]
