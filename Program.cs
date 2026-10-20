using MillionaireQuiz.Game;

var builder = WebApplication.CreateBuilder(args);

builder.Services.Configure<GameOptions>(builder.Configuration.GetSection("Game"));
builder.Services.AddSingleton<QuizBank>();
builder.Services.AddSingleton<GameStore>();

builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});

var app = builder.Build();

// Eagerly initialise singletons: loads quiz.json + persisted game state (fail fast on bad config).
var bank = app.Services.GetRequiredService<QuizBank>();
var store = app.Services.GetRequiredService<GameStore>();
app.Logger.LogInformation("Викторина загружена: {Total} вопросов, категорий: {Cats} ({Labels})",
    bank.TotalQuestions, bank.Categories.Count, string.Join(", ", bank.Categories.Select(c => c.Label)));
app.Logger.LogInformation("Состояние игры: {Phase}, команд: {Teams}", store.Snapshot().Phase, store.Snapshot().Teams.Count);

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/healthz", () => Results.Text("ok"));
app.MapGameApi();
app.MapFallbackToFile("index.html");

app.Run();
