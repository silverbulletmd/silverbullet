**TL;DR:** Please apply caution when using LLM-based coding tools to contribute code to the [main SilverBullet code base](https://github.com/silverbulletmd/silverbullet). Please do not heavily rely on LLMs to contribute to issues or community discussions.

---

There is a bubble of people that believe a simple prompt given to an LLM will produce work that is consistently good. This not my experience. While LLM-based agents _can_ be skillfully steered into producing good quality work, there is big population of people without these skills that cause a lot of confusion and noise, also in the SilverBullet community.

From time to time people “contribute” to issues or the community forums with largely LLM generated text and “analysis.” In the best case this results in a lot of text easily detected as LLM slop and ignored, but at worst it contains inaccurate information that simply detracts the conversation or results in investing time in things (e.g. verifying fake bugs) that are simply hallucinated. This is not helping anybody.

In the context of code contributions, while sloppy work is not unique to LLMs, the pace and ease in which it is produced definitely is. Since the quality of the work produced by LLMs is all over the place, I have to take it upon myself to carefully review every contribution, not knowing what prompts (if any) or level of understanding (if any) was behind it.

With humans, even in an open source setting, you build some level of relationship and trust over time with people. In the SilverBullet community I have a few contributors from whom I’ve seen the work: I know they can be trusted to do great, and I don’t have to zoom in on every single change. This is vital, and is one of the reasons why a project with the scope size of SilverBullet can still be operated by a single person. When I invest time in giving a detailed code review, I think _learning_ can happen. The person on the other end, or so I would like to believe, considers things they hadn’t considered before, learns more about the internal workings of SilverBullet and future directions I have in mind.

The ease and pace at which an AI agent produces a full pull request with meticulous sounding description and thousands of lines of code added is impressive. However, reviewing and commenting on this code can take me _hours or even days_ whereas producing it may only have taken _minutes_. A common approach for “drive by” LLM contributors is to simply copy & paste my well-considered comments back into the chatbot and see what happens. 

This is not helpful, nor is it fair game. I’ll assume people’s intentions are good, but the reality is that these contributions are simply counter productive. At scale, they can (and do) kill open source projects.

# Enforcement
I’m not the type of person that is interested in strict rules and policing. My approach is always to focus on explaining the _why_ and giving context so that people can draw their own conclusions.

If I suspect that your contribution is AI driven, I will likely close it pointing to this policy. I may get it wrong sometimes, I’m sorry about that. I’m only human, consider remaining the same.

# What this means for you
Tools like SilverBullet is all about self-expression: your notes, your thoughts, your system, your crazy experiments. I know that people use LLMs to write [[Space Lua]] scripts, and I’m happy for them. I know that LLMs help people do things that they could not do before, and even learn things in the process. That’s great. Open source is all about freedom. Do with it what you like, use it as you like. There is a solid [SilverBullet AI library](https://github.com/justyns/silverbullet-ai).

This policy only applies to the SilverBullet code base itself and its community. It is the code that I feel I should be able to understand and own, and the conversations that I decide to spend my time on contributing to. I have to make decisions that keep the project going and sustainable long term, and unproductively leveraging AI tools in contributions puts that at risk.

— [[Zef]]
