using Microsoft.Extensions.Options;

namespace MillionaireQuiz.Game;

public sealed record TeamReq(string Name);
public sealed record ActiveTeamReq(Guid TeamId);
public sealed record SpinReq(Guid? TeamId, string CategoryId);
public sealed record LifelineReq(string Type);
public sealed record TransferReq(Guid TeamId);
public sealed record AnswerReq(string Letter);
public sealed record ResetReq(bool KeepTeams);

public static class ApiEndpoints
{
    public static void MapGameApi(this WebApplication app)
    {
        var g = app.MapGroup("/api");

        g.MapGet("/config", (QuizBank bank, IOptions<GameOptions> o) => Results.Ok(new ConfigDto(
            bank.Title, bank.Subtitle, bank.Theme,
            o.Value.PhoneSeconds, o.Value.AudienceSeconds, o.Value.AnswerSeconds, o.Value.BackupPoints,
            bank.Categories.Select(c => new CatInfoDto(c.Id, c.Points, c.Label, c.IsBackup, c.Questions.Count)).ToList(),
            bank.TotalQuestions)));

        g.MapGet("/state", (GameStore s) => Results.Ok(s.Snapshot()));

        g.MapPost("/teams", (TeamReq req, GameStore s) => Act(() => s.AddTeam(req.Name)));
        g.MapDelete("/teams/{id:guid}", (Guid id, GameStore s) => Act(() => s.RemoveTeam(id)));
        g.MapPost("/start", (GameStore s) => Act(s.Start));
        g.MapPost("/active-team", (ActiveTeamReq req, GameStore s) => Act(() => s.SetActiveTeam(req.TeamId)));
        g.MapPost("/spin", (SpinReq req, GameStore s) => Act(() => s.Spin(req.TeamId, req.CategoryId)));
        g.MapPost("/lifeline", (LifelineReq req, GameStore s) => Act(() => s.Lifeline(req.Type)));
        g.MapPost("/transfer", (TransferReq req, GameStore s) => Act(() => s.Transfer(req.TeamId)));
        g.MapPost("/timeout", (GameStore s) => Act(s.Timeout));
        g.MapPost("/answer", (AnswerReq req, GameStore s) => Act(() => s.Answer(req.Letter)));
        g.MapPost("/pass", (GameStore s) => Act(s.Pass));
        g.MapPost("/close-turn", (GameStore s) => Act(s.CloseTurn));
        g.MapPost("/finish", (GameStore s) => Act(s.Finish));
        g.MapPost("/reset", (ResetReq? req, GameStore s) => Act(() => s.Reset(req?.KeepTeams ?? false)));
    }

    private static IResult Act<T>(Func<T> action)
    {
        try
        {
            return Results.Ok(action());
        }
        catch (GameException ex)
        {
            return Results.BadRequest(new { error = ex.Message });
        }
    }
}
